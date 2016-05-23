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

var spawn 	= require('child_process').spawn;
var exec 	= require('child_process').exec;
var fs 		= require('fs');
var zmq		= require('zmq');

var init_camera_script = __dirname + "/platform/linux/bootcamera.sh";

// TODO: Find and initialize all available cameras

console.log( "Launching init script: " + init_camera_script );

// Execute the init script, then set up the camera interfaces
exec( init_camera_script, function( err, stdout, stderr ) 
{
	if( err ) 
	{
		console.log( stderr );
		console.log( stdout );
		console.dir( err );

		throw err;
	}
	
	console.log( "Init script successful" );
	
	var cameras = {};

	// Setup ZMQ camera registration REQ/REP 
	var cameraRegistrationServer = zmq.socket( 'rep' );

	cameraRegistrationServer.bind( "ipc:///tmp/geomux_registration.ipc" );
	cameraRegistrationServer.on( 'message', function( msg )
	{
		registration = JSON.parse( msg );
		
		if( registration.type === "camera_registration" )
		{
			if( cameras[ registration.camera ] !== undefined )
			{
				delete( cameras[ registration.camera ] );
			}
			
			console.log( "Camera came online: [" + registration.camera + "]" );
		
			// Create a camera
			cameras[ registration.camera ] = require( "camera.js" )( registration.camera, cameraRegistrationServer );
			
			// Tell the daemon that it is good to go
			cameraRegistrationServer.send( JSON.stringify( { "response": 1 } ) );
		}
	} );

	console.log( "Spawning geomux" );

	// TODO: Spawn all necessary geomuxpp daemons for each camera
	// Spawn the geomuxpp daemon for video 0
	var geomuxpp = spawn( 'geomuxpp', [ '0' ] );

	// Optionally listen to geomuxpp standard IO
	geomuxpp.stdout.on( 'data', function( data ) 
	{
		//console.log( data.toString() );
	} );

	geomuxpp.stderr.on( 'data', function( data ) 
	{
		//console.error( "GEOMUXPP ERROR: " + data.toString() );
	} );

	geomuxpp.on( 'close', function( code ) 
	{
		console.log( "geomuxpp exited with code: " + code );
	} );
	
});

