#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
geoCameraFound=$(mxcam list | grep -q 'device #1')

if ! $geoCameraFound
then
    echo 'No Geo Camera found'
    exit 1004
fi

awaitingBoot=$(mxcam whoami | grep -q 'Waiting for USB boot')

if $awaitingBoot 
then
    echo 'Booting camera'
    mxcam boot $DIR/../../firmware/gc6500_ddrboot_fw.gz.img $DIR/../../geoconf/ov4689_H264_1080p24.json
else
    echo 'Camera already booted'
fi

#videoDevice=$(file somefile | awk '{print $5}')