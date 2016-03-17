const mdns=require('mdns');
var ad;
module.exports = function serviceAnnounce(serviceName,port,metadata){
    ad = mdns.createAdvertisement(mdns.tcp(serviceName), port,{ txtRecord: metadata});
    ad.on('error', function(error) {
        console.log('something bad happened. we better start over.');
        console.dir(error);
    });
    ad.start();
    console.log("Advertised msdn service");
    return ad;
};
