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
	.usage( "Usage: $0 -c [cam0] [cam1] [camX] -p [port number] -u [relative url] -w [socket.io path]" )
	.array( "c" )
	.number( "p" )
	.string( "u" )
	.string( "w" )
	.demand( [ "c", "p", "u", "w" ] )
	.fail( function (msg, err) 
	{
		error( "Error parsing arguments: " + msg );
		error( "Exiting..." );
		process.exit(1);
	})
	.argv;
	
var bootedCameras 	= [];
var defaults		= {};
var cameras 		= {};
var daemonsStarted	= false;

// Validate and set arguments
try
{	
	bootedCameras = argv.c;
	
	if( bootedCameras.length == 0 )
	{
		throw "No cameras specified";
	}
	
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

var server		= require('http').createServer();
server.listen( defaults.port, function () 
{
  console.log( 'Geo Video Server Listening on ' + defaults.port );
})

var plugin 		= require('socket.io')(server,{origins: '*:*',path:defaults.wspath });

var deps 		=
{
	server: server,
	plugin: plugin,
	defaults: defaults
}

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
			cameras[ registration.camera ] = require( "camera.js" )( registration.camera, deps );
			
			log( "Camera " + registration.camera + " registered" );
			
			// Send registration success to daemon
			regServer.send( JSON.stringify( { "response": 1 } ) );
		}
		else if( registration.type === "channel_registration" )
		{
			log( "Channel registration request: " + registration.camera + "_" + registration.channel );
			
			// Create a channel object
			cameras[ registration.camera ].emit( "channel_registration", registration.channel, function()
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

// Handle multiple connects to the goe-video-server
plugin.on( "connection", function( client )
{
	console.log( "New geo-video-server connection!" );
	
	client.on( "geomux.ready", function()
	{		
		console.log( "Got ready from plugin" );
		
		// Listen for camera commands and route them to the correct camera
		client.on( "geomux.command", function( camera, command, params )
		{
			if( cameras[ camera ] !== undefined )
			{
				cameras[ camera ].emit( "command", command, params );
			}
		} );
		
		// Allow late joiners to get latest camera state
		client.on( "geomux.requestCameraInfo", function( callback )
		{
			var cams = {};
			
			// For each camera
			Object.keys( cameras ).map( function( cam )
			{
				// For each channel
				Object.keys( cam.channels ).map( function( channel )
				{
					cams[ cam ] = cams[ cam ] || {};
					
					// Create a new channel object with a subset of the properties
					cams[ cam ][ channel ] =
					{
						api: cameras[ channel ].api,
						settings: cameras[ channel ].settings
					}
				});
			});
			
			// Pass the data into the callback
			callback( cams );
		} );
		
		// Only start the daemons once
		if( daemonsStarted === false )
		{
			daemonsStarted = true;
						
			// Start a geomuxpp daemon for each booted camera
			bootedCameras.map( function( camera ) 
			{				
				// Create all launch options
				var launch_options = 
				[ 
					"nice", "-1",
					"geomuxpp", camera
				];
				
				const infinite = -1;
 
				// Launch the video server with specified options. Attempt to restart every 1s.
				var monitor = respawn( launch_options,
				{
					name: "geomuxpp[" + camera + "]",
					maxRestarts: infinite,
					sleep: 30000
				} );
				
				monitor.on('crash',function()
				{
					log( "geomuxpp[" + camera + "] crashed" );
				});
				
				monitor.on('spawn',function(process)
				{
					log( "geomuxpp[" + camera + "] spawned" );
				});
				
				monitor.on('warn',function(error)
				{
					log( "geomuxpp[" + camera + "] warning: " + error );
				});
				
				monitor.on('exit',function(code, signal)
				{
					log( "geomuxpp[" + camera + "] exited: code: " + code + " signal: " + signal);
				});

				// Optional stdio logging
				monitor.on('stdout',function(data)
				{
					var msg = data.toString('utf-8');
					log( "geomuxpp[" + camera + "]: " + msg );
				});

				monitor.on('stderr',function(data)
				{
					var msg = data.toString('utf-8');
					log( "geomuxpp[" + camera + "] ERROR: " + msg );
				});

				console.log( "Starting geomuxpp[" + camera + "]..." );
				monitor.start();
			} );
		}
	} );
} );


