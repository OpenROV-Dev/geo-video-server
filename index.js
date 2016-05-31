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

var defaults = 
{
	port: 		process.env.GEO_PORT || 8099,
	url: 		'',
	wspath: 	process.env.GEO_WSPATH || '/geovideo',
};

var spawn 		= require('child_process').spawn;
var zmq			= require('zmq');
var log       	= require('debug')( 'app:log' );
var error		= require('debug')( 'app:error' );
var argv 		= require('minimist')( process.argv );

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
var bootedCameras 	= [];
var daemonsStarted	= false;



// Do some string processing on the camera input
try
{
	var camOption = argv.c;
	var withoutBraces = argv.c.replace(/\[|\]/gi,'' );
	
	if( withoutBraces === "" )
	{
		throw "No cameras specified";
	}
	else
	{
		bootedCameras = withoutBraces.split( ',' );
		
		if( bootedCameras === undefined || bootedCameras.length == 0 )
		{
			throw "No cameras specified";
		}
	}
}
catch( err )
{
	error( "No cameras specified! Ending program!" );
	throw "Error getting camera list: " + err;
}

var cameras = {};

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
				log( "Starting geomuxpp for camera: " + camera );
				
				// Spawn the geomuxpp daemon for video 0
				var geomuxpp = spawn( 'geomuxpp', [ camera ] );

				// Optionally listen to geomuxpp standard IO
				geomuxpp.stdout.on( 'data', function( data ) 
				{
					//log( data.toString() );
				} );

				geomuxpp.stderr.on( 'data', function( data ) 
				{
					//error( "GEOMUXPP ERROR: " + data.toString() );
				} );

				geomuxpp.on( 'close', function( code )
				{
					log( "geomuxpp[" + camera + "] exited with code: " + code );
				} );
			} );
		}
	} );
} );


