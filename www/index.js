var express = require('express');
var app = express();

console.log(__dirname);
app.use(express.static(__dirname + '/public'));
app.use('/components',express.static(__dirname + '/bower_components'));
app.use('/components',express.static(__dirname + '/public/webcomponents'));
app.use('/socket.io',express.static(__dirname + '/../node_modules/socket.io-client'));


app.listen(8098, function () {
  console.log('Example app listening on port 8098!');
});
