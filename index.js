#!/usr/bin/env node

// To eliminate hard coding paths for require, we are modifying the NODE_PATH to include our lib folder
var oldpath = '';

if( process.env[ 'NODE_PATH' ] !== undefined )
{
    oldpath = process.env[ 'NODE_PATH' ];
}

// Append modules directory to path
process.env['NODE_PATH'] = __dirname + '/modules:' + oldpath;
require('module').Module._initPaths();

const respawn 	= require('respawn');
var zmq			= require('zmq');
var log       	= require('debug')( 'app:log' );
var error		= require('debug')( 'app:error' );

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


// Establish a connection with the server plugin
// Handle multiple connects to the goe-video-server
plugin.on( "connection", function( client )
{
	// Listen for ready message from server plugin
	log( "New geo-video-server connection!" );
	
	client.on( "geomux.ready", function()
	{	
		log( "Got ready from plugin" );

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

		// Start listening for camera registrations
		ListenForCameraRegistrations();

		// Start camera find/boot timer
		setInterval( function()
		{
			// Get list of available geo cameras
			var cameras = EnumerateCameras();

			// Loop through each camera
			for( camera in cameras )
			{
				// If the camera has never been seen before, create a new entry for it in available cameras
				if( availableCameras[ camera.offset ] == undefined )
				{
					availableCameras[ camera.offset ] 				= camera;
					availableCameras[ camera.offset ].daemon 		= null;
					availableCameras[ camera.offset ].daemonStarts 	= 0;
				}

				// Check camera's boot state
				var booted = IsCorrectlyBooted( camera );

				// Easy reference to the camera in question
				var cam	= availableCameras[ camera.offset ];

				// Handle each combination of boot state and daemon state

				if( !booted && !cam.daemon )
				{
					// Boot the camera
					BootCamera( cam, function( error )
					{
						if( error )
						{
							error( "Error booting camera" );
							return;
						}
						
						// Create daemon
						StartDaemon( cam );
					} );
				}

				if( !booted && cam.daemon )
				{
					// Stop & delete daemon
					cam.daemon.stop();
					delete cam.daemon;

					// Boot the camera
					BootCamera( cam, function( error )
					{
						if( error )
						{
							error( "Error booting camera" );
							return;
						}
						
						// Create daemon
						StartDaemon( cam );
					} );
				}

				if( booted && !cam.daemon )
				{
					if( cam.daemonStarts < 3 )
					{
						// Create daemon
						StartDaemon( cam );
					}
				}

				// Otherwise, do nothing
			}
		}, 10000 );		
	} );
} );

// Emit video registration
self.deps.globalEventLoop.emit( 'video-deviceRegistration', results );
		
// -----------------------
// Helper functions
  
// Creates a list with all of the dectected video devices
function EnumerateCameras()
{
	var results = [];
	
	fs.readdir('/dev', function (err, files) 
	{
		if( err ) 
		{
			return;
		}
    
		var f = files.filter( function(file)
		{
			return file.indexOf('video') == 0;
		} );
		
		if( f.length == 0 )
		{
			// No video devices
			return;
		}
    
		f.forEach( function( file )
		{
			// Query the video device 
			exec( 'udevadm info --query=all --name=/dev/' + file + ' | grep "S: v4l/by-id/"', function(error, stdout, stderr)
			{
				// Check for GEO vendor string
				if( ( error == null ) && ( stdout.indexOf( 'GEO_Semi_Condor' ) > 0 ) )
				{
					// Create a result entry
					var result = 
					{
						// NOTE: Add another field for camera offset and change device back to "video0"?
						offset:   	file.slice( "video".length ),
						device:		file,
						deviceid: 	stdout.slice( "S: v4l/by-id/".length ),
						format:   	'MP4'
					};

					results.push( result );
				}
			});
		});
	});

	return results;
}

function BootCamera( camera, callback )
{
	exec( path.dirname(require.resolve('geo-video-server'))+'/platform/linux/bootcamera.sh', function( error, stdout, stderr )
	{
		if( error )
		{
			error( "Error booting camera [" + camera.offset + "] - " + error );
			
		}
	} );
}		

function IsCorrectlyBooted( camera )
{
	return false;
}

function StartDaemon( camera )
{
	// Start geomuxpp for booted camera
		// Forward stdout and stderr
		// On exit, remove from available and registered cameras
	
	// Create all launch options
	var launch_options = 
	[ 
		"nice", "-1",
		"geomuxpp", camera
	];
	
	const infinite = -1;

	// Launch the video server with specified options. Attempt to restart every 1s.
	camera.daemon = respawn( launch_options,
	{
		name: "geomuxpp[" + camera + "]",
		maxRestarts: infinite,
		sleep: 30000
	} );
	
	camera.daemon.on('crash',function()
	{
		log( "geomuxpp[" + camera + "] crashed" );
	});
	
	camera.daemon.on('spawn',function(process)
	{
		log( "geomuxpp[" + camera + "] spawned" );
	});
	
	camera.daemon.on('warn',function(error)
	{
		log( "geomuxpp[" + camera + "] warning: " + error );
	});
	
	camera.daemon.on('exit',function(code, signal)
	{
		log( "geomuxpp[" + camera + "] exited: code: " + code + " signal: " + signal);
	});

	// Optional stdio logging
	camera.daemon.on('stdout',function(data)
	{
		var msg = data.toString('utf-8');
		log( "geomuxpp[" + camera + "]: " + msg );
	});

	camera.daemon.on('stderr',function(data)
	{
		var msg = data.toString('utf-8');
		log( "geomuxpp[" + camera + "] ERROR: " + msg );
	});

	console.log( "Starting geomuxpp[" + camera + "]..." );
	camera.daemon.start();
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
