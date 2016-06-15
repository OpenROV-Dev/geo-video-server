var log       	= require('debug')( 'app:log' );
var error		= require('debug')( 'app:error' );
var path		= require( 'path' );
var execP 		= require('child-process-promise').exec;
var Q 			= require( "q" );
var fs          = require('fs');

var readdir     = Q.denodeify( fs.readdir );
var readFile    = Q.denodeify( fs.readFile );

GetCameraUSBMap();


