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
	location: 	process.env.GEO_LOCATION || "forward",
	port: 		process.env.GEO_PORT || 8099,
	device: 	process.env.GEO_DEVICE || '0',
	url: 		process.env.GEO_URL || ':' + ( process.env.GEO_PORT || 8099 ) + '/',
	wspath: 	process.env.GEO_WSPATH || '/geovideo',
};

var spawn 		= require('child_process').spawn;
var exec 		= require('child_process').exec;
var fs 			= require('fs');
var zmq			= require('zmq');
var io			= require('socket.io')( defaults.port );
var plugin		= io.of( defaults.wspath );
var log       	= require('debug')( 'app:log' );
var error		= require('debug')( 'app:error' );

var deps = 
{
	io: io,
	plugin: plugin,
	defaults: defaults
}

var init_camera_script 	= __dirname + "/platform/linux/bootcamera.sh";

// Execute the init script, then set up the camera interfaces
// TODO: Find and initialize all available cameras, not just video0
exec( init_camera_script, function( err, stdout, stderr ) 
{
	if( err ) 
	{
		error( stderr );
		error.dir( err );
		log( stdout );
		
		throw err;
	}
	
	// TODO: Return value of camera script should be list of successfully booted cameras
	// Temporarily, we just put camera 0 in there
	var bootedCameras = [ defaults.device ];
	
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
	
	// Listen for camera commands and route them to the correct camera
    plugin.on( "geomux.command", function( camera, command, params )
    {
		if( cameras[ camera ] !== undefined )
		{
			cameras[ camera ].emit( "command", command, params );
		}
    } );

	// Start a geomuxpp daemon for each booted camera
	bootedCameras.map( function( camera ) 
	{
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
			log( "geomuxpp exited with code: " + code );
		} );
	} );
});

