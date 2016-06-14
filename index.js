#!/usr/bin/env node

// To eliminate hard coding paths for require, we are modifying the NODE_PATH to include our lib folder
var oldpath = '';

if( process.env[ 'NODE_PATH' ] !== undefined )
{
    oldpath = process.env[ 'NODE_PATH' ];
}

// Append modules directory to path
process.env['NODE_PATH'] = __dirname + ':' + oldpath;
require('module').Module._initPaths();

const respawn 	= require('respawn');
var zmq			= require('zmq');
var log       	= require('debug')( 'app:log' );
var error		= require('debug')( 'app:error' );
var path		= require( 'path' );
var execP 		= require('child-process-promise').exec;
var Q 			= require( "q" );

// Get command line arguments
var argv = require( "yargs" )
	.usage( "Usage: $0 -p [port number] -u [relative url] -w [socket.io path]" )
	.number( "p" )
	.string( "u" )
	.string( "w" )
	.demand( [ "p", "u", "w" ] )
	.fail( function (msg, err) 
	{
		error( "Error parsing arguments: " + msg );
		error( "Exiting..." );
		process.exit(1);
	})
	.argv;
	
var defaults = {};

// Validate and set arguments
try
{	
	// -p=<port number>
	defaults.port 	= argv.p;
	
	// -u=<relative url>
	defaults.url 	= argv.u;
	
	// -w=<ws path>
	defaults.wspath = argv.w;
}
catch( err )
{
	error( "Error parsing arguments: " + err );
	error( "Exiting..." );
	process.exit(1);
}

// Create HTTP server
var server = require('http').createServer();
server.listen( defaults.port, function () 
{
console.log( 'geo-video-server listening on ' + defaults.port );
})

// Create Socket.IO server for interactions with server plugin
var plugin = require( 'socket.io' )( server,{ origins: '*:*', path: defaults.wspath } );

var deps =
{
	server: server,
	plugin: plugin,
	defaults: defaults
}

var availableCameras = {};
var registeredCameras = {};
var readyReceived = false;

// Check for new cameras every 10 secs
var UpdateCameras = function()
{
	log( "Checking for new cameras" );

	GetAvailableCameras()
	.then( function( cameras )
	{
		// Add new cameras to the available cameras list
		for( var camera in cameras )
		{
			if( availableCameras[ camera ] == undefined )
			{
				availableCameras[ camera ] 				= {};
				availableCameras[ camera ].info			= cameras[ camera ];
				availableCameras[ camera ].daemon 		= null;
				availableCameras[ camera ].daemonStarts = 0;
			}
			else
			{
				// Update camera info
				availableCameras[ camera ].info	= cameras[ camera ];
			}
		}

		log( "Cameras: " );
		log( availableCameras );

		// Do all settled stuff here.
		var HandleBoot = function( index )
		{
			var camera = availableCameras[ index ];

			if( camera === undefined )
			{
				throw "Camera [" + index + "] does not exist";
			}
			else
			{
				// Handle each combination of boot state and daemon state
				if( !camera.info.booted && !camera.daemon )
				{
					log( "Booting camera for first time: " + index );

					// Boot the camera
					return BootCamera( index );
				}
				else if( !camera.info.booted && camera.daemon )
				{
					log( "Shutting down daemon for un-booted camera: " + index );

					
					var deferred = Q.defer();

					// Stop & delete daemon
					camera.daemon.stop( function()
					{
						delete camera.daemon;
						deferred.resolve();
					});

					return deferred.promise.then( function()
					{
						// Boot the camera and start the daemon
						return BootCamera( index );
					});	
				}
				else if( camera.info.booted && !camera.daemon )
				{
					log( "Starting daemon for booted camera: " + index );

					if( camera.daemonStarts < 3 )
					{
						// Create daemon
						return StartDaemon( index )
						.then( function()
						{
							// Emit video registration
							plugin.emit( 'video-deviceRegistration', camera.info );
						} );
					}
				}
				else if( cameras[ index ] == undefined )
				{
					// Remove non-existent cameras
					log( "Removed non-existent camera: " + index );

					if( camera.daemon !== undefined )
					{
						var deferred = Q.defer();

						// Stop the daemon and delete this camera
						camera.daemon.stop( function()
						{
							delete camera;
							deferred.resolve();
						});

						return deferred.promise;
					}
				}
				else
				{
					// Otherwise, do nothing
					log( "Nothing to do" );
				}
			}
		}

		// All settled
		var camPromises = Object.keys( availableCameras ).map( HandleBoot );

		log( "Handling" );

		Q.allSettled( camPromises )
		.then( function( results )
		{
			setTimeout( UpdateCameras, 5000 );
		})
	});
};

LoadKernelModule()
.then( function()
{
	// Establish a connection with the server plugin
	plugin.on( "connection", function( client )
	{
		// Listen for ready message from server plugin
		log( "New geo-video-server connection!" );
		
		// Listen for camera commands and route them to the correct camera
		client.on( "geomux.command", function( camera, command, params )
		{
			if( registeredCameras[ camera ] !== undefined )
			{
				registeredCameras[ camera ].emit( "command", command, params );
			}
			else
			{
				error( "Camera [" + camera + "] - Failed to execute command: " + command + "( " + JSON.stringify( params ) + " ) - Camera doesn't exist." );
			}
		} );

		client.on( "geomux.ready", function()
		{	
			if( readyReceived == true )
			{
				return;
			}

			log( "Got ready from plugin" );
			readyReceived = true;

			// Start listening for camera registrations
			ListenForCameraRegistrations();
			UpdateCameras();
		} );
	} );
} )
.catch( function( err )
{
	error( "Error in promise chain: " + err );
});
		
// -----------------------
// Helper functions
  
function LoadKernelModule()
{
	return execP( "platform/linux/loadkernelmodule.sh" );
}	

function GetAvailableCameras()
{
	var cameras = {};

    // Call mxcam to get a list of available cameras 
    return execP( 'mxcam list' )
	.then( function( result )
    {
		log( "handling mxcam list" );
		
		if( result.stdout.indexOf( "No Compatible device" ) != -1 )
		{
			error( "No cameras found" );
		}
		else
		{
			var entries = result.stdout.split( "device " );
			
			for( var i = 0; i < entries.length; i++ )
			{
				if( entries[ i ] !== '' )
				{
					var index   = entries[ i ].match( /\#(.*)\:/)[1];
					var core    = entries[ i ].match( /(Core: )(.*)(\n)/)[2];
					var state   = entries[ i ].match( /(State: )(.*)(\n)/)[2];
					var id      = entries[ i ].match( /(ID: )(.*)(\n)/)[2];
					var bus     = ~~entries[ i ].match( /(Bus number: )(.*)(\n)/)[2];
					var device  = ~~entries[ i ].match( /(Device address: )(.*)(\n)/)[2];

					cameras[ index ] = 
					{ 
						core: core,
						state: state,
						booted: ( state === "Booted" ),
						id: id,
						bus: bus,
						device: device
					};

					log( "Found camera: " + index );
				}
			}
		}

		log( "Got cameras" );
		log( cameras );
		return cameras;	
    })
	.catch( function( err )
	{
		error( "Error getting camera list: " + err );
		return cameras;
	})
}

function BootCamera( camera, callback )
{
	return execP( "platform/linux/bootcamera.sh -c=" + camera )
	.then( function()
	{
		return camera;
	} );
}		


function StartDaemon( camera )
{
	// Create all launch options
	var launch_options2 = 
	[ 
		"nice", "-1",
		"kate"
	];

	// Create all launch options
	var launch_options = 
	[ 
		"nice", "-1",
		"geomuxpp", camera
	];
	
	const infinite = -1;

	// Launch the video server with specified options. Attempt to restart every 1s.
	availableCameras[ camera ].daemon = respawn( launch_options2,
	{
		name: "geomuxpp[" + camera + "]",
		maxRestarts: infinite,
		sleep: 30000
	} );
	
	availableCameras[ camera ].daemon.on('crash',function()
	{
		log( "geomuxpp[" + camera + "] crashed" );
	});
	
	availableCameras[ camera ].daemon.on('spawn',function(process)
	{
		log( "geomuxpp[" + camera + "] spawned" );
	});
	
	availableCameras[ camera ].daemon.on('warn',function(error)
	{
		log( "geomuxpp[" + camera + "] warning: " + error );
	});
	
	availableCameras[ camera ].daemon.on('exit',function(code, signal)
	{
		log( "geomuxpp[" + camera + "] exited: code: " + code + " signal: " + signal);

		// Remove from registered cameras
		if( registeredCameras[ camera ] !== undefined )
		{
			delete registeredCameras[ camera ];
		}
	});

	// Optional stdio logging
	availableCameras[ camera ].daemon.on('stdout',function(data)
	{
		var msg = data.toString('utf-8');
		log( "geomuxpp[" + camera + "]: " + msg );
	});

	availableCameras[ camera ].daemon.on('stderr',function(data)
	{
		var msg = data.toString('utf-8');
		log( "geomuxpp[" + camera + "] ERROR: " + msg );
	});

	console.log( "Starting geomuxpp[" + camera + "]..." );
	availableCameras[ camera ].daemon.start();
}

function ListenForCameraRegistrations()
{
	// Setup ZMQ camera registration REQ/REP 
	var regServer = zmq.socket( 'rep' );

	// Listen for camera and channel registrations over ZeroMQ
	regServer.bind( "ipc:///tmp/geomux_registration.ipc" );
	regServer.on( 'message', function( msg )
	{
		try
		{
			var registration = JSON.parse( msg );

			if( registration.type === "camera_registration" )
			{
				log( "Camera registration request: " + registration.camera );
				
				// Create a channel object
				registeredCameras[ registration.camera ] = require( "camera.js" )( registration.camera, deps );
				
				log( "Camera " + registration.camera + " registered" );
				
				// Send registration success to daemon
				regServer.send( JSON.stringify( { "response": 1 } ) );
			}
			else if( registration.type === "channel_registration" )
			{
				log( "Channel registration request: " + registration.camera + "_" + registration.channel );
				
				// Create a channel object
				registeredCameras[ registration.camera ].emit( "channel_registration", registration.channel, function()
				{					
					log( "Channel " + registration.camera + "_" + registration.channel + " registered" );
					
					// Send registration success to daemon
					regServer.send( JSON.stringify( { "response": 1 } ) );
				} );
			}
		}
		catch( err )
		{
			error( "Error in registration: " + err );
			
			// Send registration failure to daemon
			regServer.send( JSON.stringify( { "response": 0 } ) );
		}
	} );
};
