# hubble-mitm
Used to create a proxy to intercept messages and alter traffic to hubble services.

I use this to dump out the authentication information that is needed to view my baby-monitor from Motorola via a local RTSP stream instead of via their app.

Basically I redirect all "*.hubble.in" traffic in the LAN to this service. Open up the hubble app on my mobile via the WIFI/Lan and let it tak to the hubble service. It creates new keys that is automatically dumped to the file system and then they can be used to auhthenticate to the camera. 

If anyone wish to make this into a more stable package or whatever, please feel free to do so! 
