const express     = require('express');
const https       = require('https');
const http        = require('http');
const vhost       = require("vhost");
const bodyParser  = require('body-parser')
const fs          = require('fs');
const tls         = require('tls');
const path        = require('path');
const axios       = require('axios');

console.log("Virtual Hubble v2006.01");
console.log();

const agent = new https.Agent({  
      rejectUnauthorized: false
  });

//Support function to create a context for https
function createContext(domain) {
    return tls.createSecureContext({
        key: fs.readFileSync(path.join('./certs/fakehubble.key')),
        cert: fs.readFileSync(path.join('./certs/fakehubble.crt')),
      });
}

// Download cert file support function
async function downloadCert (url,filename) {  
    const filePath = path.resolve(__dirname, './certs/'+filename)
    const writer = fs.createWriteStream(filePath)
  
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream'
    })
  
    response.data.pipe(writer)
  
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
  }

// Just pass the request on to the backend
function passthrough(uri,method,req,res,cb=undefined) {
    if (method==='post') {
        axios.post(uri, req.body, {headers: req.headers, httpsAgent: agent}).then((response) => {
            res.status(200).send(response.data);        
            if (cb) {cb(response.data)};        
        }, (error) => {
            res.status(400).send(error.data);
        });
    } else if (method==='delete') {
        axios.delete(uri, {headers: req.headers, httpsAgent: agent}).then((response) => {
            res.status(200).send(response.data);        
            if (cb) {cb(response.data)};        
        }, (error) => {
            res.status(400).send(error.data);
        });
    } else {
        axios.get(uri, {headers: req.headers, httpsAgent: agent}).then((response) => {
            res.status(200).send(response.data);
            if (cb) {cb(response.data)};        
        }, (error) => {
            res.status(400).send(error.data);
        });        
    }
}  

//Request authentication token
function authentication_token(host, req, res) {
    var login = req.body.login

    console.log("["+host+"]: Requested authentication_token.json for " + login);
    axios.post('https://'+host+'/v4/users/authentication_token.json', req.body, {headers: req.headers, httpsAgent: agent}
    ).then((response) => {

        console.log("   > Authentication succeeded");
        let data = JSON.stringify(response.data);
        fs.writeFileSync('./data/user_'+response.data.data.authentication_token+".json", data);

        res.status(200).send(response.data);        
    }, (error) => {
        console.log("   > Authentication failed");
        res.status(400).send(error.data);
    });
}

// Deliver result from the server
function me(host, req, res) {
    var api_key = req.query["api_key"];
    console.log("["+host+"]: Requested me.json using api_key "+api_key);
    var result = JSON.parse(fs.readFileSync('./data/user_'+api_key+'.json'))
    res.status(200).send({
        "status":200,
        "message":"",
        "data":{
            "uuid": result.data.uuid,
            "email": result.data.uuid,
            "name": result.data.name,
            "roles": result.data.roles,
            "authentication_token": result.data.authentication_token,
            "id": result.data.id,
            "recurly_id": result.data.recurly_id,
            "created_at": result.data.created_at,
            "updated_at": result.data.updated_at,
            "packageName": result.data.packageName
        }
    });
}

// Define the sites we are running
const sites = {
    "ota.hubble.in": {
        context: createContext('ota.hubble.in'),
        app: express()
    },
    "cs.hubble.in": {
        context: createContext('cs.hubble.in'),
        app: express()
    },
    "api.hubble.in": {
        context: createContext('api.hubble.in'),
        app: express()
    },
    "bootstrap.hubble.in": {
        context: createContext('bootstrap.hubble.in'),
        app: express()
    },
};

// Configure basic settings for all sites
for(var url in sites) {
    sites[url].app.set('trust proxy', 1); 
    sites[url].app.use(bodyParser.urlencoded({ extended: false }))
    sites[url].app.use(bodyParser.json())
    sites[url].app.use('/certs', express.static('./certs'))   
}

// Specifics for cs.hubble.in
sites['cs.hubble.in'].app.get('/v1/devices/config_details.json', function (req, res) {
    var device_token = req.query["device_token"];
    console.log("[cs.hubble.in]: Requested config_details.json for "+device_token);

    axios.get('https://cs.hubble.in/v1/devices/config_details.json?device_token='+device_token, {headers: req.headers, httpsAgent: agent}
    ).then((response) => {

        downloadCert(response.data.data.certificate_data.ca_crt,"device_"+device_token+"_ca.crt");
        console.log("   > Downloaded Device CA cert")
        downloadCert(response.data.data.certificate_data.client_crt,"device_"+device_token+"_client.crt");
        console.log("   > Downloaded Device Client Cert")
        downloadCert(response.data.data.certificate_data.client_key,"device_"+device_token+"_client.key");
        console.log("   > Downloaded Device Client Key")
        res.status(200).send(response.data);    
    }, (error) => {
        res.status(400).send(response.data);
    });

});

sites['api.hubble.in'].app.get('/v2/devices/:deviceid/events.json', function(req,res) {
    var api_key = req.query["api_key"];
    var deviceid = req.params["deviceid"];
    console.log("[bootstrap.hubble.in]: Passthrough device events for "+deviceid +" using api_key "+api_key);
    passthrough('https://api.hubble.in/v2/devices/'+deviceid+'/events.json?api_key='+api_key,'get',req,res);    
});

sites['api.hubble.in'].app.get('/v1/users/device_models', function(req, res){
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Requested device_models using api_key "+api_key);
    
   axios.get('https://api.hubble.in/v1/users/device_models?api_key='+api_key, {headers: req.headers, httpsAgent: agent}
    ).then((response) => {

        for(let registration in response.data) {
            console.log("   > Created device file "+response.data[registration].registrationId);
            fs.writeFileSync('./data/device_'+response.data[registration].registrationId+".json", JSON.stringify(response.data[registration]));
        }    

        res.status(200).send(response.data);        
    }, (error) => {
        console.log("   > Failed");
        res.status(400).send(error.data);
    });    
    
});

sites['api.hubble.in'].app.get('/v6/devices/own.json', function(req, res){
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Requested device_models using api_key "+api_key);
    
   axios.get('https://api.hubble.in/v6/devices/own.json?api_key='+api_key, {headers: req.headers, httpsAgent: agent}
    ).then((response) => {

        for(let device in response.data.data) {
            var shortcutContent = "rtsp://"+ 
                response.data.data[device].p2p_credentials.p2pId + ":" +
                response.data.data[device].p2p_credentials.p2pKey + "@" +
                response.data.data[device].device_location.local_ip + ":6667/blinkhd";
            console.log("   > Created url file for device "+response.data.data[device].name);
            fs.writeFileSync('./data/url_'+response.data.data[device].name+".txt", shortcutContent);
                
            //Modyfy to intercept
            response.data.data[device].device_location.local_ip = "192.168.100.210";
            response.data.data[device].device_location.remote_ip = "192.168.100.210";
            response.data.data[device].device_location.local_port_1 = "6667";
            response.data.data[device].mac_address = "281878FFDB54";

            console.log("   > Created owner file "+response.data.data[device].registration_id);
            fs.writeFileSync('./data/own_'+response.data.data[device].registration_id+".json", JSON.stringify(response.data.data[device]));
        }    
        res.status(200).send(response.data);        
    }, (error) => {
        console.log("   > Failed");
        res.status(400).send(error.data);
    });    
    
});

var net = require('net');
net.createServer(function(socket){
    socket.on('data', function(data){
        socket.write(data.toString())
    });
}).listen(6667);

var net = require('net');
net.createServer(function(socket){
    socket.on('data', function(data){
        socket.write(data.toString())
    });
}).listen(8080);

var net = require('net');
net.createServer(function(socket){
    socket.on('data', function(data){
        socket.write(data.toString())
    });
}).listen(51000);

var net = require('net');
net.createServer(function(socket){
    socket.on('data', function(data){
        socket.write(data.toString())
    });
}).listen(53000);

sites['api.hubble.in'].app.post('/v4/users/authentication_token.json', function(req, res) {
    authentication_token('api.hubble.in',req,res);
})

sites['api.hubble.in'].app.get('/v1/users/me.json', function(req, res){
    me('api.hubble.in',req,res);
});

sites['api.hubble.in'].app.get('/currency/me', function(req,res) {
    console.log("[api.hubble.in]: Passthrough Currency");
    passthrough('https://api.hubble.in/currency/me','get',req,res);
});

sites['api.hubble.in'].app.get('/v6/user_consents', function(req, res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Passthrough consents using api_key "+api_key);
    passthrough('https://api.hubble.in/v6/user_consents?api_key='+api_key,'get',req,res)
});

sites['api.hubble.in'].app.post('/v6/user_consents', function(req, res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Passthrough consents using api_key "+api_key);
    passthrough('https://api.hubble.in/v6/user_consents?api_key='+api_key,'post',req,res)
});



sites['api.hubble.in'].app.get('/v6/user_consents', function(req, res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Passthrough consents using api_key "+api_key);
    passthrough('https://api.hubble.in/v6/user_consents?api_key='+api_key,'get',req,res)
});

sites['api.hubble.in'].app.get('/v2/devices/subscriptions.json', function(req, res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Passthrough subscriptions using api_key "+api_key);
    passthrough('https://api.hubble.in/v2/devices/subscriptions.json?api_key='+api_key,'get',req,res)
});

sites['api.hubble.in'].app.get('/v1/user_preferences', function(req, res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Passthrough user preferences using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/user_preferences?api_key='+api_key,'get',req,res)
});

sites['api.hubble.in'].app.get('/v1/user_preferences', function(req, res) {
    var api_key = req.query["api_key"];
    var page_size = req.query["page_size"];
    var tag_type = req.query["tag_type"];
    var page_no = req.query["page_no"];
    console.log("[api.hubble.in]: Passthrough user preferences using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/user_preferences?api_key='+api_key+'&page_size='+page_size+'&tag_type='+tag_type+'&page_no='+page_no,'get',req,res)
});

sites['api.hubble.in'].app.get('/v2/devices/events.json', function(req, res) {
    var api_key = req.query["api_key"];
    var reg_ids = req.query["reg_ids"];
    var alerts = req.query["alerts"];
    var models = req.query["models"];
    var include = req.query["include"];
    var page = req.query["page"];

    console.log("[api.hubble.in]: Passthrough user preferences using api_key "+api_key);
    passthrough('https://api.hubble.in/v2/devices/events.json?api_key='+api_key+'&reg_ids='+reg_ids+'&alerts='+alerts+'&models='+models+'&include='+include+'&page='+page,'get',req,res)
});

sites['api.hubble.in'].app.get('/v6/uploads/user_content', function(req, res) {
    var api_key = req.query["api_key"];
    var page_size = req.query["page_size"];
    var tag_type = req.query["tag_type"];
    var page_no = req.query["page_no"];
    console.log("[api.hubble.in]: Passthrough user content using api_key "+api_key);
    passthrough('https://api.hubble.in/v6/uploads/user_content?api_key='+api_key+'&page_size='+page_size+'&tag_type='+tag_type+'&page_no='+page_no,'get',req,res)
});
    

sites['api.hubble.in'].app.get('/v1/baby_tracker/profile', function(req,res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Requested baby tracker profile using api_key "+api_key);
    res.status(200).send([]);
});

sites['api.hubble.in'].app.get('/v1/profile', function(req, res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Passthrough profile using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/profile?api_key='+api_key,'get',req,res)
});

sites['api.hubble.in'].app.post('/v1/profile', function(req, res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Passthrough profile using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/profile?api_key='+api_key,'post',req,res)
});

sites['api.hubble.in'].app.get('/v6/users/initialize', function(req, res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Passthrough profile using api_key "+api_key);
    passthrough('https://api.hubble.in/v6/users/initialize?api_key='+api_key,'get',req,res)
});

sites['api.hubble.in'].app.get('/v1/devices/:id/check_status.json', function(req, res) {
    var api_key = req.query["api_key"];
    var id = req.params["id"];
    console.log("[api.hubble.in]: Passthrough check status using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/devices/'+id+'/check_status.json?api_key='+api_key,'get',req,res)
});

sites['api.hubble.in'].app.get('/v1/devices/:id/attribute', function(req, res) {
    var api_key = req.query["api_key"];
    var id = req.params["id"];
    console.log("[api.hubble.in]: Passthrough device attributes using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/devices/'+id+'/attribute?api_key='+api_key,'get',req,res)
});

sites['api.hubble.in'].app.post('/v1/devices/:id/attribute', function(req, res) {
    var api_key = req.query["api_key"];
    var id = req.params["id"];
    console.log("[api.hubble.in]: Passthrough post device attributes using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/devices/'+id+'/attribute?api_key='+api_key,'post',req,res)
});

sites['api.hubble.in'].app.get('/v1/subscription_plans.json', function(req, res) {
    var api_key = req.query["api_key"];
    var page = req.params["page"];
    var size = req.params["size"];
    console.log("[api.hubble.in]: Passthrough subcription plans for api_key "+api_key);
    passthrough('https://api.hubble.in/v1/subscription_plans.json?api_key='+api_key+'&page='+page+'&size='+size,'get',req,res)
});


sites['api.hubble.in'].app.post('/v1/users/me/change_password.json', function(req, res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Passthrough change password using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/users/me/change_password.json?api_key='+api_key,'post',req,res)
});

sites['api.hubble.in'].app.get('/v1/baby_tracker/profile', function(req,res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Requested baby tracker profile using api_key "+api_key);
    res.status(200).send([]);
});

sites['api.hubble.in'].app.post('/v1/apps/register.json', function(req,res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Requested device registration using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/apps/register.json?api_key='+api_key, "post", req, res);
});

sites['api.hubble.in'].app.post('/v1/apps/:id/register_notifications.json', function(req,res) {
    var api_key = req.query["api_key"];
    var id = req.params["id"];
    console.log("[api.hubble.in]: Requested register notifications using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/apps/'+id+'/register_notifications.json?api_key='+api_key, "post", req, res);
});

sites['api.hubble.in'].app.post('/v1/apps/:id/unregister_notifications.json', function(req,res) {
    var api_key = req.query["api_key"];
    var id = req.params["id"];
    console.log("[api.hubble.in]: Requested unregister notifications using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/apps/'+id+'/unregister_notifications.json?api_key='+api_key, "post", req, res);
});

sites['api.hubble.in'].app.delete('/v1/apps/:id/unregister.json', function(req,res) {
    var api_key = req.query["api_key"];
    var id = req.params["id"];
    console.log("[api.hubble.in]: Requested unregister notifications using api_key "+api_key);
    passthrough('https://api.hubble.in/v1/apps/'+id+'/unregister.json?api_key='+api_key, "delete", req, res);
});

sites['api.hubble.in'].app.get('/v1/users/certificates.json', function(req,res) {
    var api_key = req.query["api_key"];
    console.log("[api.hubble.in]: Requested certificates.json using api_key "+api_key);

    axios.get('https://api.hubble.in/v1/users/certificates.json?api_key='+api_key, req.body, req.headers
    ).then((response) => {

        downloadCert(response.data.data.mqtt_certificates.ca_crt,"mqtt_ca.crt");
        console.log("   > Downloaded MQTT CA cert")
        downloadCert(response.data.data.mqtt_certificates.client_crt,"mqtt_client.crt");
        console.log("   > Downloaded MQTT Client Cert")
        downloadCert(response.data.data.mqtt_certificates.client_key,"mqtt_client.key");
        console.log("   > Downloaded MQTT Client Key")

        res.status(200).send(response.data);
    
    }, (error) => {
        res.status(400).send(error.data);
    });
});

sites['bootstrap.hubble.in'].app.post('/v4/users/authentication_token.json', function(req, res) {
    authentication_token('bootstrap.hubble.in',req,res);
})

sites['bootstrap.hubble.in'].app.post('/v1/user/me.json', function(req, res){
    me('bootstrap.hubble.in',req,res);
});

sites['bootstrap.hubble.in'].app.get('/v6/bootstrap/info', function(req,res) {
    console.log("[bootstrap.hubble.in]: Passthrough Bootstrap Info");
    axios.get('https://bootstrap.hubble.in/v6/bootstrap/info', {headers: req.headers, httpsAgent: agent}).then((response) => {
        res.status(200).send(response.data);        
    }, (error) => {
        res.status(400).send(error.data);
    });        
});

// Setup all the 404 handlers as the last thing we do
for(var url in sites) {
    sites[url].app.use(function (req, res, next) { 
        console.log("["+req.vhost.hostname+"] Could not find ("+req.method+"): "+req.originalUrl)
        res.status(404).send("Sorry can't find that!")
    });    
}

// Create the main application
var app = express();
for (let url in sites) {
  console.log("Registering vhost for " + url);
  app.use(vhost(url, sites[url].app));
}

// Spin up HTTP listeners
var httpServer = http.createServer(app);
httpServer.listen(80, function () {
   console.log("Listener started for HTTP on port 80")
});

// Spin up HTTPS listeneres
var secureOptions = {
    SNICallback: function (domain,cb) {
      domain = domain.trim();
      if (domain in sites) {
        return cb(null, sites[domain].context);
      } else {
        console.log("Cannot find host "+domain)
        return cb(Error('No such host found'),null);
      }
    },
    key: fs.readFileSync(path.join('./certs','fakehubble.key')).toString(),
    cert: fs.readFileSync(path.join('./certs','fakehubble.crt')).toString()
  };

var httpsServer = https.createServer(secureOptions, app);  
httpsServer.listen(443, function () {
    console.log("Listener started for HTTPS on port 443")
 });
