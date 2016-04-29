#!/usr/bin/env node

// To eliminate hard coding paths for require, we are modifying the NODE_PATH to include our lib folder
var oldpath = '';

if( process.env[ 'NODE_PATH' ] !== undefined )
{
    oldpath = process.env[ 'NODE_PATH' ];
}

// Just in case already been set leave it alone
process.env['NODE_PATH'] = __dirname + '/modules:' + oldpath;
require('module').Module._initPaths();
console.log( "Set NODE_PATH to: " + process.env['NODE_PATH'] );


var spawn 	= require('child_process').spawn;
var exec 	= require('child_process').exec;
var fs 		= require('fs');
var zmq		= require('zmq');

var init_camera_script = __dirname + "/platform/linux/bootcamera.sh";
var self = this;

// TODO: Find all available cameras

// TODO: Initialize all available cameras
// Execute the init script
var bootscript = exec( init_camera_script, function( err, stdout, stderr ) 
{
	if( err ) 
	{
		console.log( stderr );
		console.log( stdout );
		console.dir( err );

		throw err;
	};    
});

var cameras = {};

// Create zeromq listeners
var cameraRegistrationServer = zmq.socket( 'rep' );

cameraRegistrationServer.bind( "ipc:///tmp/geomux_registration.ipc" );
cameraRegistrationServer.on( 'message', function( msg )
{
	cameraRegistration = JSON.parse( msg );
	
	console.log( "Camera came online: [" + cameraRegistration.offset + "]" );
	
	// Create a camera
	cameras[ cameraRegistration.offset ] = require( "camera.js" )( cameraRegistration.offset );
	
	// Tell the daemon that it is good to go
	cameraRegistrationServer.send( JSON.stringify( { "response": 1 } ) );
} );

// TODO: Spawn all necessary geomuxpp daemons
// Spawn the geomuxpp daemon for video 0

var geomuxpp = spawn( 'geomuxpp', [ '0' ] );

geomuxpp.stdout.on( 'data', function( data ) 
{
	//console.log( data.toString() );
} );

geomuxpp.stderr.on( 'data', function( data ) 
{
	//console.log( data.toString() );
} );

geomuxpp.on( 'close', function( code ) 
{
	console.log( "child process exited with code: " + code );
} );