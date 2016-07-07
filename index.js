#!/usr/bin/env node

// To eliminate hard coding paths for require, we are modifying the NODE_PATH to include our lib folder
var oldpath = '';

if( process.env[ 'NODE_PATH' ] !== undefined )
{
    oldpath = process.env[ 'NODE_PATH' ];
}

// Append modules directory to path
process.env['NODE_PATH'] = __dirname + '/:' + __dirname + "/modules/:" + oldpath;
require('module').Module._initPaths();

const respawn 	= require('respawn');
var zmq			= require('zmq');
var log       	= require('debug')( 'app:log' );
var error		= require('debug')( 'app:error' );
var path		= require( 'path' );
var execP 		= require('child-process-promise').exec;
var Q 			= require( "q" );
var fs			= require( "fs" );

var readdir     = Q.denodeify( fs.readdir );
var readFile    = Q.denodeify( fs.readFile );

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
	.then( RemoveStaleCameras )
	.then( BootCameras )
	.then( GetCameraUSBMap )
	.then( UpdateCameraUSBInfo )
	.then( StartDaemons )
	.then( PostDeviceRegistrations )
	.catch( function( err )
	{
		error( "Error updating cameras: " + err );
	} )
	.then( function()
	{
		setTimeout( UpdateCameras, 5000 );
	})
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
	return execP( __dirname + "/platform/linux/loadkernelmodule.sh" );
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
				}
			}
		}

		return cameras;	
    })
	.catch( function( err )
	{
		error( "Error getting camera list: " + err );
		return cameras;
	})
}

function RemoveStaleCameras( cameras )
{
	var RemoveStale = function( index )
	{
		var camera = availableCameras[ index ];

		if( cameras[ index ] == undefined )
		{
			// Remove non-existent cameras
			log( "Removed non-existent camera: " + index );

			var deferred = Q.defer();

			if( camera.daemon )
			{
				// Stop the daemon and delete this camera
				camera.daemon.stop( function()
				{
					delete availableCameras[ index ];
					deferred.resolve();
				});

				return deferred.promise;
			}
			else
			{
				
				delete availableCameras[ index ];

				deferred.resolve();
				return deferred.promise;
			}
		}
	}

	// All settled
	var promises = Object.keys( availableCameras ).map( RemoveStale );

	return Q.allSettled( promises )
	.then( function()
	{
		return cameras;
	})
}

function BootCameras( cameras )
{
	// Add new cameras to the available cameras list
	for( var camera in cameras )
	{
		if( availableCameras[ camera ] == undefined )
		{
			availableCameras[ camera ] 				= {};
			availableCameras[ camera ].mxcamInfo	= cameras[ camera ];
			availableCameras[ camera ].usbInfo		= null;
			availableCameras[ camera ].daemon 		= null;
			availableCameras[ camera ].daemonStarts = 0;
		}
		else
		{
			// Update camera info
			availableCameras[ camera ].mxcamInfo	= cameras[ camera ];
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
			if( !camera.mxcamInfo.booted )
			{
				log( "Booting camera for first time: " + index );

				// Boot the camera
				return BootCamera( index );
			}
			else
			{
				log( "Nothing to do" );
			}
		}
	}

	// All settled
	var camPromises = Object.keys( availableCameras ).map( HandleBoot );

	log( "Handling" );

	return Q.allSettled( camPromises );
}

function BootCamera( camera )
{
	log( "Booting camera: " + camera );

	return execP( __dirname + "/platform/linux/bootcamera.sh -c=" + camera )
	.then( function( result )
	{
		error( result.stderr );
		log( result.stdout );
		return camera;
	} );
}		

// Creates a list with all of the dectected video devices
function GetCameraUSBMap()
{
    var usbMap = {};
    var i = 0;

    return readdir( '/dev' )
    .then( function( results )
    {
        var f = results.filter( function(file)
        {
            return file.indexOf('video') == 0;
        });

        return f;
    } )
    .then( function( files )
    {    
        var GetUSBInfoFromDevFile = function( file )
        {
            var udev_command = "udevadm info --query=all --name=" + file;

            return execP( udev_command )
            .then( function( result )
            {
                // Check to make sure its a geo
                if( result.stdout.indexOf( "Condor" ) == -1 )
                {
                    throw "Not a GEO cam";
                }

                var interface = ~~result.stdout.match( /(ID_USB_INTERFACE_NUM=)(.*)(\n)/)[2];

                if( interface !== 0 )
                {
                    throw "Not the primary interface";
                }

                // DEVPATH=/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.2/video4linux/video4
                var devpath = path.dirname( "/sys" + result.stdout.match( /(DEVPATH=)(.*)(video4linux)/)[2] );
                var port = path.basename( devpath );

                var bus = null;
                var dev = null;

                var GetBusNum = readFile( devpath + "/busnum", "utf-8" )
                .then( function( busnum )
                {
                    bus = ~~busnum;
                });

                var GetDevNum = readFile( devpath + "/devnum", "utf-8" )
                .then( function( devnum )
                {
                    dev = ~~devnum;
                } );
                
                return Q.all( [ GetBusNum, GetDevNum ] )
                .then( function( results )
                {
                    // Add info to the map
                    usbMap[ bus + ":" + dev ] = 
                    {
                        path: "/dev/" + file,
                        name: file,
                        port: port,
						offset: file.slice( "video".length )
                    };
                })
            });
        };

        var promises = files.map( GetUSBInfoFromDevFile );

        return Q.allSettled( promises );           
    })
    .then( function( results )
    {
        return usbMap;
    })
    .catch( function( err )
    {
        error( "Error constructing USB map: " + err );
        return {};
    } );
};

function UpdateCameraUSBInfo( usbMap )
{
	var UpdateCameras = function( index )
	{
		var camera = availableCameras[ index ];

		if( camera.mxcamInfo.booted )
		{
			if( usbMap[ camera.mxcamInfo.bus + ":" + camera.mxcamInfo.device ] !== undefined )
			{
				camera.usbInfo = usbMap[ camera.mxcamInfo.bus + ":" + camera.mxcamInfo.device ];
				log( "Camera usb info: " + JSON.stringify( camera.usbInfo ) );
			}
		}
	}

	// All settled
	var promises = Object.keys( availableCameras ).map( UpdateCameras );

	return Q.allSettled( promises );
};

function StartDaemons()
{
	log( "Checking daemon status" );

	var Start = function( index )
	{
		var camera = availableCameras[ index ];

		if( !camera.daemon )
		{
			if( camera.usbInfo )
			{
				log( "Creating daemon for: " + index );
				StartDaemon( index );
			}
		}
	}

	// All settled
	var promises = Object.keys( availableCameras ).map( Start );

	return Q.allSettled( promises );
};

function StartDaemon( camera )
{
	// // Create all launch options
	// var launch_options2 = 
	// [ 
	// 	"nice", "-1",
	// 	"kate"
	// ];

	// Create all launch options
	var launch_options = 
	[ 
		"nice", "-1",
		"geomuxpp", availableCameras[ camera ].usbInfo.offset
	];
	
	const infinite = -1;

	// Launch the video server with specified options. Attempt to restart every 1s.
	availableCameras[ camera ].daemon = respawn( launch_options,
	{
		name: "geomuxpp[" + camera + "]",
		maxRestarts: infinite,
		sleep: 15000
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

function PostDeviceRegistrations()
{
	var update = [];

	var GetRegistrationInfo = function( index )
	{
		if( availableCameras[ index ].usbInfo )
		{
			var n = {
				device: availableCameras[ index ].usbInfo.offset,
				deviceid: "test",
				format: 'MP4'
			};

			log( "new device: " + JSON.stringify( n ) );
			update.push(n);
		}
	}

	Object.keys( availableCameras ).map( GetRegistrationInfo );

	log( "Emitting video info" );
	plugin.emit('video-deviceRegistration',update);
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
