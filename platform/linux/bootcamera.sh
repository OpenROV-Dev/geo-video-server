#!/bin/bash
# Handle input options
for i in "$@"
do
case $i in

    -c=*)      
    CAMERA_INDEX="${i#*=}"
    shift
    ;;
    
    # unknown option
    *)        
    ;;
esac
done


if [ -z "${CAMERA_INDEX}" ]; 
then
	echo "No camera specified"
    exit 1
fi

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "--------------"
echo "Booting camera: ${CAMERA_INDEX}"

# echo "Setting boot mode to USB..."
# mxcam --device ${CAMERA_INDEX} bootmode usb
# sleep 1
# echo "Flashing bootloader..."
# mxcam --device ${CAMERA_INDEX} flash --silent --bootloader $DIR/../../firmware/gc6500_btld_ddrboot_534_epwr.rom
# sleep 3
# echo "Resetting camera..."
# mxcam --device ${CAMERA_INDEX} reset
# sleep 3
echo "Loading firmware and configuration..."
mxcam --device ${CAMERA_INDEX} boot $DIR/../../firmware/gc6500_ddrboot_fw.gz.img $DIR/../../geoconf/ov4689_H264_1080p30.json
echo "Camera booted!"

exit 0