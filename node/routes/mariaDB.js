var express = require('express');
var router = express.Router();
var Client = require('mariasql'); //https://github.com/mscdex/node-mariasql
var crypto = require('crypto');
var timezoneJS = require('timezone-js');
var config=require('../config');
var moment=require('moment');


var mariaDBConfig={
  host: config.mariaDB.host,
  user: config.mariaDB.user,     //
  password: config.mariaDB.password,      // Please input your password
  multiStatements: true,
  pingInactive:300, //in seconds 
  pingWaitRes:60 //in seconds. time for waiting ping response 
}


var c = new Client(mariaDBConfig);

c.query('set names utf8;');
c.query("use takit;");
c.on('close',function(){
    console.log("DB close c.connected:"+c.connected);
	console.log("DB close c.connecting:"+c.connecting);
}).on('error', function(err) {
   console.log('Client error: ' + err);
}).on('connect', function() {
   console.log('Client connected');
});

router.setDir=function(__dirname){
	timezoneJS.timezone.zoneFileBasePath = __dirname+'/tz';
	timezoneJS.timezone.init({ async: false });
}

var flag;
function performQuery(command,handler){
    console.log("performQuery with command="+command+ " connected:"+c.connected+" connecting:"+c.connecting+" threadId"+c.threadId);
    if(!c.connected){                         // Anyother way? It could be dangerous. any mutex? 
        c.connect(mariaDBConfig);
        c.on("ready",function(){
	    console.log("mariadb ready");
            c.query('set names utf8;');
            c.query("use takit;");
            c.query(command,handler);
	});
    }else{
        c.query(command,handler);
    }
}

function performQueryWithParam(command,value,handler){
    console.log("performQuery with command="+command+ " connected:"+c.connected+" connecting:"+c.connecting+" threadId"+c.threadId);
    if(!c.connected){                         // Anyother way? It could be dangerous. any mutex?
        c.connect(mariaDBConfig);
        c.on("ready",function(){
            console.log("mariadb ready");
            c.query('set names utf8;');
            c.query("use takit;");
            c.query(command,value,handler);
        });
    }else{
        console.log("call c.query with value "+JSON.stringify(value));
    	function defaultHandler(){
           console.log("c.query returns");
           flag=true;
           handler();
        }
        console.log("call c.query");
        c.query(command,value,handler);
	}
}


//encrypt data

function encryption(data,pwd){
	var cipher = crypto.createCipher('aes256',pwd);
	var secretData = cipher.update(data,'utf8','hex');
	secretData += cipher.final('hex');
	
	return secretData;
} 

//decrypt decrepted data

function decryption(secretData, pwd){
	var decipher = crypto.createDecipher('aes256',pwd);
	var data=decipher.update(secretData,'hex','utf8');
	data += decipher.final('utf8');
	
	return data;
}

//decrpt userInfo,shopInfo ...etc
function decryptObj(obj){
	if(obj.hasOwnProperty('referenceId') && obj.referenceId !==null ){
   		obj.referenceId=decryption(obj.referenceId, config.rPwd);
	}	

	if(obj.hasOwnProperty('email') && obj.email !==null){
		obj.email=decryption(obj.email, config.ePwd);	
	}

	if(obj.hasOwnProperty('phone') && obj.phone !==null){
		obj.phone=decryption(obj.phone, config.pPwd);
	}
		
	if(obj.hasOwnProperty('userPhone') && obj.userPhone !== null){
		obj.userPhone=decryption(obj.userPhone,config.pPwd);
	}	
}


router.existUserEmail=function(email,next){
	var secretEmail = encryption(email,config.ePwd);
	
	var command="select *from userInfo where email=?";
	var values=[secretEmail];
   console.log("existUserEmail is called. command:"+command);

	performQueryWithParam(command,values,function(err, result) {
        console.log("c.query success");
		if (err){
			next(err);
		}else{
			console.dir("[existUser]:"+result.info.numRows);
			if(result.info.numRows==="0"){
				next("invaildId");
			}else{
				decryptObj(result[0]);
				next(null,result[0]);
			}
		}
	});
};

router.existEmailAndPassword=function(email, password,next){
	let secretEmail = encryption(email,config.ePwd);

	let command="SELECT userInfo.*, cashId FROM userInfo LEFT JOIN cash ON userInfo.userId = cash.userId WHERE email=?";
   let values=[secretEmail];

	performQueryWithParam(command,values, function(err,result){
   	if(err){
    		console.log(err);
    		next(err);
   	}else{
      	//console.log("[existUser]:"+result.info.numRows);
      	if(result.info.numRows==="0"){
        		next("invalidId");
    		}else{
        		let userInfo = result[0];
        		let secretPassword = crypto.createHash('sha256').update(password+userInfo.salt).digest('hex');
       
        		if(secretPassword === userInfo.password){
        			console.log("password success!!");
        			decryptObj(userInfo);
					next(null,userInfo);
        		}else{
        			next("passwordFail");
        		}
			}
		}
	});
};

router.existUser=function(referenceId,next){
   let secretReferenceId = encryption(referenceId,config.rPwd);
	let command="SELECT userInfo.*, cashId FROM userInfo LEFT JOIN cash ON userInfo.userId = cash.userId WHERE referenceId=?";
   let values = [secretReferenceId]
	performQueryWithParam(command, values, function(err, result) {
		if (err){
			console.log("query error:"+JSON.stringify(err));
			next(err);
		}else{
			console.dir("[existUser function numRows]:"+result.info.numRows);
			if(result.info.numRows==="0"){
				next("invalidId");
		  	}else{
				decryptObj(result[0]);
				next(null,result[0]);
		  }
		}
	});
};

router.getUserPaymentInfo=function(id,successCallback,errorCallback){
	var command="select name,email,phone from userInfo where id=\""+id+"\";";
	console.log("command:"+command);
	performQuery(command,function(err, result) {
		  if (err){
			  console.log(JSON.stringify(err));
			  errorCallback(err);
		  }
		  console.dir("[getUserPaymentInfo]:"+result.info.numRows);
		  if(result.info.numRows==="0"){
			  errorCallback("invalid DB status");
		  }else{
			  console.log("result[0]:"+JSON.stringify(result[0]));
			  successCallback(result[0]);
		  }
	});
};


router.insertUser=function(referenceId,password,name,email,countryCode,phone,phoneValidity,next){
	console.log("referenceId:"+referenceId+" password:"+password+" name:"+name+" country:"+countryCode+" phone:"+phone+" phoneValidity:"+phoneValidity);
	
	// referenceId encrypt
	var secretReferenceId = encryption(referenceId, config.rPwd);	

	var salt;
	var secretPassword='';
	
	//1. password encrypt	
	if(password === null || password === ''){
		salt = null;
		secretPassword = null;
	}else{
		salt = crypto.randomBytes(16).toString('hex');
		secretPassword = crypto.createHash('sha256').update(password+salt).digest('hex');
	}
	
	//2. email encrypt
	var secretEmail = encryption(email,config.ePwd);	
	
	//3. phone encrypt
	var secretPhone = encryption(phone,config.pPwd);

	console.log("secretReferenceId :"+secretReferenceId+" secretEmail : "+secretEmail+" secretPhone:"+secretPhone);

	var command='INSERT IGNORE INTO userInfo (referenceId,password,salt,name,email,countryCode,phone,phoneValidity,lastLoginTime) VALUES (?,?,?,?,?,?,?,?,?)';
	var values=[secretReferenceId,secretPassword,salt,name,secretEmail,countryCode,secretPhone,phoneValidity,new Date().toISOString()];
    	
	performQueryWithParam(command,values, function(err, result) {
		if (err){
			console.log(JSON.stringify(err));
			next(err);
		}else{
			console.log("insertUser func result"+JSON.stringify(result));
			if(result.info.affectedRows === '0'){
						
				next(null,"duplication")
			}else{
				//console.log(JSON.stringify(result));
				next(null,result.info.insertId);
			} 
		}
	});
};

router.validUserwithPhone = function(userId, name,phone, next){

   let command = "SELECT *FROM userInfo WHERE userId=? and name=? and phone = ?";
	var secretPhone = encryption(phone,config.pPwd);
	let values = [userId,name,secretPhone];

   performQueryWithParam(command,values,function(err,result){
      if(err){
         console.log("validUserwithPhone function error:"+JSON.stringify(err));
         next(err);
      }else{
         if(result.info.numRows==="0"){
            next("invalidId");
         }else{
            console.log("validUserwithPhone function success");
            next(null,"validId");
         }
      }
   });
}

router.getUserInfo=function(userId,next){
	var command="SELECT *FROM userInfo WHERE userId=?";
	var values = [userId];
	performQueryWithParam(command,values,function(err,result) {
		  if (err){
			console.error("getUserInfo func Unable to query. Error:", JSON.stringify(err, null, 2));
			  next(err);
		  }else{
			  console.dir("[Get userInfo]:"+result.info.numRows);
			  if(result.info.numRows==0){
				  next(null,{});
			  }else{
				console.log("Query succeeded. "+JSON.stringify(result[0]));
				decryptObj(result[0]);	
				next(null,result[0]);
			  }
		  }
	});
}

router.deleteUserInfo=function(userId,next){
    console.log("userId:"+userId);

    var command="DELETE FROM userInfo where userId=?"; //userInfo에 shopList 넣기
    var values = [userId];

    performQueryWithParam(command,values,function(err,result){
        if(err){
                console.log("deleteUserInfo function err:"+err);
                next(err);
        }else{
                console.log("deleteUserInfo function Query succeeded"+JSON.stringify(result));
                next(null);
        }
    });
}

//shop user 정보 가져옴.

router.existShopUser=function(referenceId,next){
  var secretReferenceId = encryption(referenceId,config.rPwd);
  var command="SELECT shopUserInfo.*, name, email FROM shopUserInfo LEFT JOIN userInfo ON shopUserInfo.userId=userInfo.userId where shopUserInfo.referenceId=?";
  var values=[secretReferenceId];

  performQueryWithParam(command,values,function(err, result) {
    if(err){
      console.log("existShopUser function query error:"+JSON.stringify(err));
        next(err);
      }else{
        console.dir("[existShopUser function numRows]:"+result.info.numRows);

        if(result.info.numRows==="0"){
          next("no shopUser");
        }else{
          //shop이 여러개일 경우에 여러개 리턴
          let shopUserInfos=[];
          result.forEach(function(shopUser){
            decryptObj(shopUser);
            shopUserInfos.push(shopUser);
          });
          console.log("shopUserInfos:"+JSON.stringify(shopUserInfos));
          next(null,shopUserInfos);
        }
      }
    });
}

///////////////여러개 샵 가지고 있으면 여러 레코드 검색됨
router.getShopUserInfo=function(userId,next){
	let command="SELECT shopUserInfo.*, name, email FROM shopUserInfo LEFT JOIN userInfo ON shopUserInfo.userId=userInfo.userId WHERE shopUserInfo.userId=?";
	let values=[userId];

	performQueryWithParam(command,values,function(err, result) {
		if(err){
		   console.log("shopUserInfo function query error:"+JSON.stringify(err));
			next(err);
		}else{
			console.dir("[shopUserInfo function numRows]:"+result.info.numRows);			
			if(result.info.numRows==="0"){				  
      		next("invalidId");
			}else{
				console.log("shopUserInfo success");
				let shopUserInfos=[];
				result.forEach(function(shopUserInfo){
					decryptObj(shopUserInfo);
					shopUserInfos.push(shopUserInfo);
				});
				
			   next(null,shopUserInfos);
			}
		}													
	});
}

//userId+takitId 로 한명의 shopUser만 검색

router.updateShopRefId= function(userId,referenceId,next){

	let secretReferenceId = encryption(referenceId, config.rPwd);
	let command = "UPDATE shopUserInfo set referenceId=? where userId=?";
	let values = [secretReferenceId,userId];

	performQueryWithParam(command, values, function(err,result){
		if(err){
			console.log(err);
			next(err);
		}else{
			console.log("updateShopRefId function result"+JSON.stringify(result));
			next(null);
		}
	});
}

router.updateUserInfo=function(userInfo,next){
	console.log("update UserInfo function start");
   const values={};
   values.email = encryption(userInfo.email,config.ePwd);
   values.salt = null;
   values.password = null;
   values.phone=null;
   values.name = userInfo.name;

   if(userInfo.hasOwnProperty('password') && userInfo.password !== null){
      values.salt = crypto.randomBytes(16).toString('hex');
      values.password = crypto.createHash('sha256').update(userInfo.password+values.salt).digest('hex');
   }
   if(userInfo.hasOwnProperty('phone') && userInfo.phone !== null){
     values.phone = encryption(userInfo.phone,config.pPwd);
   }

   let command;
   if(userInfo.hasOwnProperty('userId') && userInfo.userId !== null){
     values.userId = userInfo.userId;
     command = "UPDATE userInfo set password=:password, salt=:salt, email=:email, phone=:phone, name=:name where userId=:userId";
   }else{
     command = "UPDATE userInfo set password=:password, salt=:salt where email=:email";
   }

   performQueryWithParam(command,values,function(err,result){
     if(err){
        console.error("updateUserInfo func Unable to query. Error:", JSON.stringify(err, null, 2));
        next(err);
     }else{
        console.log("Query succeeded. "+JSON.stringify(result));
        next(null,"success");
     }
   });
}


router.insertCashId = function(userId,cashId, password, next){
   let secretCashId = encryption(cashId,config.cPwd);//cashId 에 대한 비밀번호 설정하기!

   let salt = crypto.randomBytes(16).toString('hex');
	let secretPassword = crypto.createHash('sha256').update(password+salt).digest('hex');

   let command = "INSERT INTO cash(userId, cashId, password, salt) values(?,?,?,?)";
   let values = [userId, secretCashId, secretPassword, salt];
   
   performQueryWithParam(command,values,function(err,result){
		if(err){
         console.error("insertCashId func Unable to query. Error:", JSON.stringify(err));
         next(err);
      }else{
         console.log("insertCashId Query succeeded.");
         next(null,"success");
      }
	});

};

router.updateCashInfo=function(userId,cashId,password,next){
   let secretCashId = encryption(cashId,config.cPwd);//cashId 에 대한 비밀번호 설정하기!

   let salt = crypto.randomBytes(16).toString('hex');
	let secretPassword = crypto.createHash('sha256').update(password+salt).digest('hex');

   let command = "UPDATE cash SET password=?, salt=? WHERE userId=? and cashId=?";
   let values = [secretPassword, salt, userId, secretCashId];

   performQueryWithParam(command,values,function(err,result){
		if(err){
         console.error("insertCashId func Unable to query. Error:", JSON.stringify(err));
         next(err);
      }else{
         console.log("insertCashId Query succeeded.");
         next(null,"success");
      }
   });
}

router.getCashInfo=function(cashId,next){
   console.log("getCashInfo function start");

   let command = "SELECT *FROM cash WHERE cashId=?";
   let values = [cashId];

   performQueryWithParam(command, values, function(err,result) {
      if(err){
         console.log("getCashInfo function err:"+JSON.stringify(err));
         next(err);
      }else{
         if(result.info.numRows==='0'){
            next("invalidId");
         }else{
            console.log(result);
            decryptObj(result[0]);
            next(null,result[0]);
         }
      }
   });

}

router.checkCashPwd = function(cashId, password, next){
   console.log("checkCashPwd function start");

   let command = "SELECT password, salt FROM cash WHERE cashId=?";
   let values = [cashId];

   performQueryWithParam(command, values, function(err,result) {
      if(err){
         console.log("checkCashPwd function err:"+JSON.stringify(err));
         next(err);
      }else{
         if(result.info.numRows==='0'){
            next("invalid cashId");
         }else{
            console.log("checkCashPwd function success");

            let secretPwd = crypto.createHash('sha256').update(password+result[0].salt).digest('hex');

            if(secretPwd === result[0].password){
               console.log("correct password");
               next(null,"correct cashPwd");
            }else{
               next("invalid cash Password");
            }

         }
      }
   });
}


router.findTakitId=function(req,next){
	console.log("mariaDB.findTakitId "+ req.body.hasOwnProperty("servicename")+" "+req.body.hasOwnProperty("shopname"));
	var command;
	if(req.body.hasOwnProperty("servicename") && req.body.hasOwnProperty("shopname")){
		command="SELECT serviceName,shopName from takit where serviceName LIKE _utf8\'"+req.body.servicename+"%\' and shopName LIKE _utf8\'"+req.body.shopname+"%\';";
	}else if(req.body.hasOwnProperty("servicename")){
		command="SELECT serviceName,shopName from takit where serviceName LIKE _utf8\'"+req.body.servicename+"%\';";
	}else if(req.body.hasOwnProperty("shopname")){
		command="SELECT serviceName,shopName from takit where shopName LIKE _utf8\'"+req.body.shopname+"%\';";
	}else{
		console.log("no param");
		next([]);
		return;
	}
	console.log("command:"+command);
	performQuery(command,function(err, result) {
		  if (err){
			  console.log("findTakitId Error:"+JSON.stringify(err));
			  next(JSON.stringify(err));
		  }else{
		      console.log("result:"+JSON.stringify(result));
                      if(result==undefined){
			next([]);
                      }else{  
		          console.dir("result:"+result.info.numRows);
		          var shoplist=[];
		          var idx;
		          for(idx=0;idx<result.info.numRows;idx++){
			      shoplist.push(result[idx].serviceName+"@"+result[idx].shopName);
		          }
			  console.log("shoplist:"+JSON.stringify(shoplist));
		          next(shoplist);
                      }
                  }
	});
}


function queryCafeHomeCategory(cafeHomeResponse,req, res){
	var url_strs=req.url.split("takitId=");
	var takitId=decodeURI(url_strs[1]);
	console.log("takitId:"+takitId);

	
	var command="SELECT *FROM categories WHERE takitId=?";
	var values = [takitId];
	performQueryWithParam(command,values,function(err,result) {
		  if (err){
			  console.error("queryCafeHomeCategory function Unable to query. Error:", JSON.stringify(err, null, 2));
		  }else{
			  if(result.info.numRows==0){
				  console.log("[queryCafeHomeCategory categories]:"+result.info.numRows);
			  }else{
			    console.log("queryCafeHomeCategory func Query succeeded. "+JSON.stringify(result));
			    	
			    var categories=[];
		        result.forEach(function(item) {
		            console.log(JSON.stringify(item));
		            categories.push(item);
		        });
		        
		        cafeHomeResponse.categories=categories;
		        console.log("cafeHomeResponse:"+(JSON.stringify(cafeHomeResponse)));
			console.log("send res");
		        res.end(JSON.stringify(cafeHomeResponse));

			  }
		  }
	});
}


function queryCafeHomeMenu(cafeHomeResponse,req, res){
	console.log("req url:"+req.url);	
	
	var url_strs=req.url.split("takitId=");
	var takitId=decodeURI(url_strs[1]);
	console.log(":takitId"+takitId);

	var menus=[];
	
	var command="SELECT *FROM menus WHERE menuNO LIKE '"+takitId+"%'";
	console.log("queryCafeHomeMenu command:"+command);
	performQuery(command,function(err,result) {
		  if (err){
			  console.error("queryCafeHomeMenu func Unable to query. Error:", JSON.stringify(err, null, 2));
		  }else{
			  console.dir("[Get cafeHomeMenu]:"+result.info.numRows);
			  if(result.info.numRows==0){
				  
			  }else{
				  console.log("queryCafeHomeMenu Query succeeded. "+JSON.stringify(result[0]));
				  
				  var menus=[];
				  result.forEach(function(item) {
			        	 console.log(JSON.stringify(item));
			        	 menus.push(item);
			        });
				  
				  cafeHomeResponse.menus=menus;
		          queryCafeHomeCategory(cafeHomeResponse,req, res);
				  
			  }
		  }
	});
}


router.queryCafeHome=function(req, res){
	console.log("queryCafeHome:"+JSON.stringify(req.url));
	var url_strs=req.url.split("takitId=");
	var takitId=decodeURI(url_strs[1]);
	console.log("takitId:"+takitId);
	var cafeHomeReponse={};

	var command="select *from shopInfo where takitId=?";
	var values = [takitId];
	performQueryWithParam(command,values,function(err,result) {
		  if (err){
			  console.log(err);
		  }else{
			  console.dir("[queryCafeHome function's shopInfo]:"+result);
			  if(result.info.numRows==="0"){
				  console.log("queryCafeHome function's query failure");
			  }else{
				  result.forEach(function(item) {
			            console.log(JSON.stringify(item));
			            cafeHomeReponse.shopInfo=item;
			            queryCafeHomeMenu(cafeHomeReponse,req, res);
				  });
			  }
		  }
	});
};

//shopList string으로 저장..
router.updateShopList=function(userId,shopList,next){

	console.log("updateUserInfoShopList - userId:"+userId);

   let command="UPDATE userInfo SET shopList=? where userId=?"; //userInfo에 shopList 넣기
   let values = [shopList,userId];

   performQueryWithParam(command,values,function(err,result) {
      if (err){
         console.error("updateUserInfoShopList function Unable to query. Error:", JSON.stringify(err, null, 2));
         next(err);
		}else{
         console.log("updateUserInfoShopList func Query succeeded. "+JSON.stringify(result[0]));
			next(null);
      }
   });
};


//pushId
router.updatePushId=function(userId,token,platform,next)
{
	var command="UPDATE userInfo SET pushId=?, platform=? WHERE userId=?";
	var values = [token,platform,userId];
	performQueryWithParam(command,values,function(err,result) {
		if (err){
				console.error("updatePushId func Unable to query. Error:", JSON.stringify(err, null, 2));
				next(err);
			}else{
				console.log("updatePushId func Query succeeded. "+JSON.stringify(result));
				console.log(result);
				next(null,"success");
			}
		});
};

router.getPushId=function(userId,next)
{
    let command="select pushId,platform,SMSNoti from userInfo WHERE userId=?";
    let values = [userId];
    performQueryWithParam(command,values,function(err,result) {
        if (err){
                console.error("getPushId func Unable to query. Error:", JSON.stringify(err, null, 2));
                next(err);
            }else{
				if(result.info.numRows==0){
					next("not exsit pushId");
				}else{
                	console.log("getPushId func Query succeeded. "+JSON.stringify(result[0]));
						next(null,result[0]);
            	}
			}
        });
};




router.updateShopPushId=function(userId,takitId,shopToken,platform,next)
{
    var command="UPDATE shopUserInfo SET shopPushId=?,platform=? WHERE userId=? AND takitId=?";
    var values = [shopToken,platform,userId,takitId];
    performQueryWithParam(command,values,function(err,result) {
        if (err){
                console.error("updateShopPushId func Unable to query. Error:", JSON.stringify(err, null, 2));
                next(err);
            }else{
                console.log("updateShopPushId func Query succeeded. "+JSON.stringify(result));
                next(null,"success");
            }
        });
};


router.getShopPushId=function(takitId,next){

	let command = "SELECT shopUserInfo.userId, shopPushId, shopUserInfo.platform, phone, myShopList from shopUserInfo"
                  +" LEFT JOIN userInfo on shopUserInfo.userId = userInfo.userId WHERE takitId=? and GCMNoti=?"	
	let values = [takitId,"on"];

    performQueryWithParam(command,values,function(err,result) {
        if (err){
            console.log("getShopPushId func Unable to query. Error:", JSON.stringify(err));
				next(err);
        }else{
            console.log("[getShopPushid func get shopPushId]:"+JSON.stringify(result));
            if(result.info.numRows==='0'){
                next("not exist shopUser");
            }else{
					 decryptObj(result[0]);	
                next(null, result[0]);
            }
          }
    });
}
	

router.updateShopBusiness = function(takitId,flag,next){
   console.log("enter updateShopBusiness function");
   let command="UPDATE shopInfo SET business=? WHERE takitId=?";
	let values=[flag,takitId];

   performQueryWithParam(command,values,function(err,result) {
		if (err){
			console.error("updateShopBusiness func Unable to query. Error:", JSON.stringify(err, null, 2));
			next(err);
		}else{
         console.log("updateShopBusiness result:"+JSON.stringify(result));
         next(null,"success");
		}
	});
}

//SMS Noti 끄기
router.changeSMSNoti=function(userId, flag, next){
   console.log("comes changeSMSNoti function");

   let command="UPDATE userInfo SET SMSNoti=? where userId=?";
   let values=[flag,userId];

   performQueryWithParam(command,values,function(err,result){
      if(err){
         console.error("changeSMSNoti func Unable to query. Error:", JSON.stringify(err, null, 2));
			next(err);
      }else{
         console.log("changeSMSNoti Query succeeded. "+JSON.stringify(result));
			next(null);
      }
   });

}	


router.getShopInfo=function(takitId,next){  // shopInfo 조회해서 next로 넘겨줌.
	
	console.log("enter getShopInfo function");
	var command="SELECT *FROM shopInfo WHERE takitId =?";
	var values=[takitId];
	performQueryWithParam(command,values,function(err,result) {
		if (err){
			console.error("getShopInfo func Unable to query. Error:", JSON.stringify(err, null, 2));		
			next(err);
		}else{
			console.dir("[exist shopInfo]:"+result.info.numRows);
			if(result.info.numRows==="0"){
				next("inexistant shop");
			}else{
				decryptObj(result[0]);
				next(null,result[0]);
			}
		}
	});
}

router.getDiscountRate = function(takitId,next){
   console.log("enter getDiscountRate function");
   let command="SELECT discountRate FROM shopInfo WHERE takitId=?";
	let values=[takitId];

   performQueryWithParam(command,values,function(err,result) {
		if (err){
			console.log("getDiscountRate func Unable to query. Error:", JSON.stringify(err));
			next(err);
		}else{
			console.dir("[getDiscountRate in shopInfo]:"+result.info.numRows);
			if(result.info.numRows==="0"){
				next("inexistant shop");
			}else{
				next(null,result[0].discountRate);
			}
		}
	});

};

router.updateNotiMember=function(userId,takitId,onMyShopList,offMyShopList,next){
   let command="UPDATE shopUserInfo SET GCMNoti=(case when userId=? then 'on'"
                                                +"else 'off' end),"
                                        +"myShopList=(case when userId=? then ? "
                                                      +"else ? end)where takitId=?";
   /*if userId 가 맞으면 'manager'로 변경
      else userId가 맞지 않고, if class==='manager' 이면(기존 manager인 사람) 'member'로 변경
               "          , else 나머지는 'member'
      */
   let values=[userId,userId,onMyShopList,offMyShopList, takitId];

   performQueryWithParam(command,values,function(err,result){
      if(err){
         console.log(err);
         next(err);
      }else{
         console.log(result);
         next(null,"success");
      }
   });
};


function getTimezoneLocalTime(timezone,timeInMilliSec){ // return current local time in timezone area
	console.log("timeInMilliSec:"+timeInMilliSec);
         
	var offset=(new timezoneJS.Date(Date(), timezone)).getTimezoneOffset(); // offset in minutes
	var newtime =  timeInMilliSec - (offset*60*1000);
	var currlocal= new Date(timeInMilliSec - (offset*60*1000));
	return currlocal.toISOString();
}

//increaseOrderNumber function orderNumberCounter 수 증가 시키고, 마지막 주문 시간 재 설정.
function increaseOrderNumber(takitId,next){

	var command="UPDATE shopInfo SET orderNumberCounter=orderNumberCounter+1,orderNumberCounterTime=? WHERE takitId=? and orderNumberCounter=orderNumberCounter";
   var values = [new Date().toISOString(),takitId];

	performQueryWithParam(command, values, function(err,result) {
      if(err){
         console.error("increaseOrderNumber func Unable to query. Error:", JSON.stringify(err, null, 2));
      }else{
			console.log("increaseOrderNumber func Query succeeded. "+JSON.stringify(result));
         next();
		}
	});
}  //increaseOrderNumber function end.



router.getOrderNumber=function(takitId,next){
	var command="SELECT *FROM shopInfo WHERE takitId=?"
	var values = [takitId];
	
	// 1. shopInfo 찾기 
	
	router.getShopInfo(takitId,function(err,shopInfo){
		if(err){
			next(err);
		}else{
		//orderNumberCounter = 오늘 주문수 계속 카운트.
		//orderNumberCounterTime = 가장 마지막으로 주문받은 시간 저장. => 오늘의 가장 첫 주문 확인 시에 필요.
		
		console.log("shopInfo in getOrderNumber:"+shopInfo);				  
		console.log("current orderNumberCounter:"+shopInfo.orderNumberCounter);
		console.log("current orderNuberTime:"+shopInfo.orderNumberCounterTime);	
				  
		//매일 카운트 수 리셋. orderNO도 리셋 하기 위한 작업.
			
		var timezone=shopInfo.timezone;   // 각 shop의 timezone
		var utcTime=new Date();
		var localTime; // 현재 localTime
		var counterLocalTime; //counterTime의 localTime
		var oldCounterTime="0"; //이전 counterTime

		if(shopInfo.orderNumberCounterTime !== null){
			var counterTime=new Date(Date.parse(shopInfo.orderNumberCounterTime+" GMT"));
			console.log("first order time(counter time) : "+counterTime.toISOString()); 
			localTime=getTimezoneLocalTime(timezone,utcTime.getTime()); //현재 시간의 localTime 계산
			counterLocalTime=getTimezoneLocalTime(timezone,counterTime.getTime()); //이전의 orderNumberCounterTime(UTC로 저장되어 있음)의 로컬시간 계산.
			oldCounterTime=shopInfo.orderNumberCounterTime; //저장돼 있던 정보 이전 시간으로 저장.
			console.log("localTime:"+localTime.substring(0,10));
			console.log("counterLocalTime:"+counterLocalTime.substring(0,10));
		}
		if(shopInfo.orderNumberCounterTime===null|| shopInfo.orderNumberCounterTime === undefined ||    //맨 처음 주문이거나
			localTime.substring(0,10)!==counterLocalTime.substring(0,10)){ //counterLocaltime이 어제 주문한 시간이라 localTime과 맞지 않으면(다음날이 된 경우) reset
				       
			// set orderNumberCounter as zero and then increment it
			console.log("reset orderNumberCounter");
			
			//shop에orderNumberCounterTime 없거나, orderNumberCounterTime이 어제 시간이랑 같으면(?)
			if(shopInfo.orderNumberCounterTime===null || shopInfo.orderNumberCounterTime === oldCounterTime){
				var command="UPDATE shopInfo SET orderNumberCounter=?, orderNumberCounterTime=? WHERE takitId=?";
				var values = [0,utcTime.toISOString(),takitId];
				//orderNumberCounter를 하루의 시작 0으로 리셋
				    			
				performQueryWithParam(command, values, function(err,result) {
					if(err){
						console.log("getOrderNumber func set orderNumberCounter with condition "+err);
//						if(err.code=="ConditionalCheckFailedException"){ // some one else alreay reset it 
//							increaseOrderNumber();
//						} // mariadb is what's error 
					    				  
					    	console.error("getOrderNumber func Unable to query. Error:", JSON.stringify(err));
					    	next(err);
					}else{
						console.dir("[getOrderNumber func update orderNumberCounter]:"+result.info.numRows);
					    	
						if(result.info.affectedRows==='0'){
					    		next(null,result.info.affectedRows);
					    	}else{
					    		console.log("getOrderNumber func Query succeeded. "+JSON.stringify(result));
					    		increaseOrderNumber(takitId,function(){
								router.getShopInfo(takitId,function(err,shopInfo){
									if(err){
										next(err);
									}else{
									console.log("orderNumberCounter:"+shopInfo.orderNumberCounter);
									next(null,shopInfo.orderNumberCounter);
									}
								});	
							});
					    	}
					}
				});// end update orderNumberCounterTime


			}
  	
		}else{ //같은 날의 주문일 경우
			increaseOrderNumber(takitId,function(){
         	router.getShopInfo(takitId,function(err,shopInfo){
					if(err){
						console.log(err);
						next(err);
					}else{
					console.log("orderNumberCounter:"+shopInfo.orderNumberCounter);
            	next(null,shopInfo.orderNumberCounter);
					}
         	});     
      	});     
		}
	
	        
		}
	        //////////////////////////////////////////////////////////////////////
	});
};

router.saveOrder=function(order,shopInfo,next){
   console.log("[order:"+JSON.stringify(order)+"]");
   console.log("order's takeout:"+order.takeout);
   //1. user 검색
   router.getUserInfo(order.userId,function(err,userInfo){
      //2. order insert

      //3. encrypt phone
      let secretUserPhone = encryption(userInfo.phone,config.pPwd);
      let command="INSERT INTO orders(takitId,orderName,payMethod,amount,takeout,orderNO,userId,userName,userPhone,orderStatus,orderList,orderedTime,localOrderedTime,localOrderedDay,localOrderedHour,localOrderedDate) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";

      let values = [order.takitId,order.orderName,order.paymethod,order.amount,order.takeout,order.orderNO,userInfo.userId,userInfo.name,secretUserPhone,order.orderStatus,order.orderList,order.orderedTime,order.localOrderedTime,order.localOrderedDay,order.localOrderedHour,order.localOrderedDate];
      performQueryWithParam(command, values, function(err,orderResult) {
         if (err){
            console.error("saveOrder func inser orders Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
         }else{
            //console.dir("[Add orders]:"+result);
            if(orderResult.info.affectedRows==='0'){
               next("invalid orders");
            }else{
               console.log("saveOrder func Query succeeded. "+JSON.stringify(orderResult));
               // 3.orderList insert

               let command = "INSERT INTO orderList(orderId,menuNO,menuName,quantity,options,amount) values(?,?,?,?,?,?)";
               let orderList=JSON.parse(order.orderList);

               orderList.menus.forEach(function(menu){
                  let values = [orderResult.info.insertId,menu.menuNO,menu.menuName,menu.quantity,JSON.stringify(menu.options),menu.amount];

                  performQueryWithParam(command, values, function(err,orderListResult) {
                     if(err){
                        console.error("saveOrder func insert orderList Unable to query. Error:", JSON.stringify(err, null, 2));
                        next(err);
                     }else{
                        console.log("saveOrder func insert orderList Query Succeeded");
                     }
                  });
               });
               next(null,orderResult.info.insertId);
            }
         }
      });
   });
};


//orderId로 order 검색할때
router.getOrder=function(orderId, next){

    var command="SELECT *FROM orders WHERE orderId=?";
    var values = [orderId];

    performQueryWithParam(command, values, function(err,result) {
        if (err){
            console.error("getOrder func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        }else{
            console.dir("[getOrder func Get MenuInfo]:"+result.info.numRows);
            if(result.info.numRows==0){
                next("not exist order");
            }else{
                console.log("getOrder func Query succeeded. "+JSON.stringify(result.info));
					decryptObj(result[0]);
                next(null,result[0]);
            }
        }
    });

}



//user가 주문내역 검색할 때,
router.getOrdersUser=function(userId,takitId,lastOrderId,limit,next){
	console.log("takitId:"+takitId);	
	var command;
	var values;

	if(lastOrderId == -1){
		command="SELECT *FROM orders WHERE userId=? AND takitId=? AND orderId > ?  ORDER BY orderId DESC LIMIT "+limit;

	}else{
		command="SELECT *FROM orders WHERE userId=? AND takitId=? AND orderId < ?  ORDER BY orderId DESC LIMIT "+limit;
	}

	values = [userId,takitId,lastOrderId];
 
		//해당 user와 shop에 맞는 orders 검색	
	performQueryWithParam(command, values, function(err,result) {
        if (err){
			console.error("getOrdersUser func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        }else{
			console.dir("[getOrdersUser func Get MenuInfo]:"+result.info.numRows);
			if(result.info.numRows==0){
				next(null,result.info.numRows);
			}else{
				console.log("getOrdersUser func Query succeeded. "+JSON.stringify(result.info));
				
				var orders=[];
				
				result.forEach(function(order){
					decryptObj(order);
					orders.push(order);
				});
				
				next(null,orders);
			}
		}
	})

}


//shop에서 주문내역 검색할 때
router.getOrdersShop=function(takitId,option,lastOrderId,limit,next){
	console.log("takitId:"+takitId);

	function queryOrders(startTime){
		if(lastOrderId == -1){

			var command="SELECT *FROM orders WHERE takitId=? AND orderedTime > ? AND orderId > ?  ORDER BY orderId DESC LIMIT "+limit;
		}else{
			var command="SELECT *FROM orders WHERE takitId=? AND orderedTime > ? AND orderId < ?  ORDER BY orderId DESC LIMIT "+limit;
		}
		var values = [takitId,startTime,lastOrderId];
		performQueryWithParam(command, values, function(err,result) {
			  if (err){
				  console.error("queryOrders func Unable to query. Error:", JSON.stringify(err, null, 2));
				  next(err);
			  }else{
				  console.dir("[queryOrders func Get MenuInfo]:"+result.info.numRows);
				  if(result.info.numRows==0){
					  next("not exist orders");
				  }else{
					  console.log("queryOrders func Query succeeded. "+JSON.stringify(result.info));

					var orders=[];
					result.forEach(function(order){
						decryptObj(order);
						orders.push(order);
					});

					  next(null,orders);
				  }
			  }
		});
	} //end queryOrders


	var command="SELECT *FROM shopInfo WHERE takitId=?";
	var values = [takitId];
	performQueryWithParam(command, values, function(err,result) {
		  if (err){
			  console.error("getOrdersShop func Unable to query. Error:", JSON.stringify(err, null, 2));
			  next(err);
		  }else{
			  console.dir("[getOrdersShop func Get shopInfo]:"+result.info.numRows);
			  if(result.info.numRows==0){
				  next("not exist shop");
			  }else{
				console.log("getOrdersShop func Query succeeded. "+JSON.stringify(result));
				console.log("timezone:"+result[0].timezone);

				var startTime = getTimezoneLocalTime(result[0].timezone, (new Date).getTime()).substring(0,11)+"00:00:00.000Z";
				var localStartTime=new Date(Date.parse(startTime));
				var offset=(new timezoneJS.Date(new Date(), result[0].timezone)).getTimezoneOffset(); // offset in minutes
				var queryStartTime;

				if(option==="today"){
					var todayStartTime=new Date(localStartTime.getTime()+(offset *60*1000));
					console.log("todayStartTime in gmt:"+todayStartTime.toISOString());
					queryStartTime=todayStartTime.toISOString();
				}else if(option==="week"){
					var weekStartTime=new Date(localStartTime.getTime()-24*60*60*6*1000+(offset *60*1000));
					console.log("weekStartTime in gmt:"+weekStartTime.toISOString());
					queryStartTime=weekStartTime.toISOString();
				}else if(option==="month"){
					var tomorrow= new Date(localStartTime.getTime()+(offset *60*1000));
					var monthAgo=moment(tomorrow).subtract(1,'M').toDate();
					queryStartTime=monthAgo.toISOString();
				}else{
					return;
				}
				console.log("queryStartTime:"+queryStartTime);
				queryOrders(queryStartTime);
			  }
		  }
	});
};


router.getPeriodOrdersShop=function(takitId,startTime,endTime,lastOrderId,limit,next){
	console.log("takitId:"+takitId+" startTime:"+startTime+" end:"+endTime);

	if(lastOrderId == -1){
		var command="SELECT *FROM orders WHERE takitId=? AND orderedTime BETWEEN ? AND ? AND orderId > ?  ORDER BY orderId DESC LIMIT "+limit;
	}else{
		var command="SELECT *FROM orders WHERE takitId=? AND orderedTime BETWEEN ? AND ? AND orderId < ?  ORDER BY orderId DESC LIMIT "+limit;
	}
	var values = [takitId,startTime,endTime,lastOrderId];

	performQueryWithParam(command, values, function(err,result) {
		if (err){
			console.error("getPeriodOrders func Unable to query. Error:", JSON.stringify(err, null, 2));
			next(err);
		}else{
			console.dir("[getPeriodOrders func Get MenuInfo]:"+result.info.numRows);

			if(result.info.numRows==0){
				next("not exist orders");
			}else{
				console.log("getPeriodOrders func Query succeeded. "+JSON.stringify(result.info));
				 var orders=[];
                    result.forEach(function(order){
						decryptObj(order);
                        orders.push(order);
                    });

                next(null,orders);
			}
		}
	});


};



//order's noti mode 에서 필요한 order를 가져옴.
router.getOrdersNotiMode=function(userId, next){
	console.log("getOrdersNotiMode comes!!!");
	
	let currentTime = new Date();
	console.log(currentTime);
	let currentTimeStr = currentTime.toISOString().substring(0, 19).replace('T', ' ');
	let yesterDayTime = new Date(currentTime.getTime()-86400000) // 86400000 = 하루 만큼의 milliseconds
	console.log(yesterDayTime);
	let yesterDayTimeStr = yesterDayTime.toISOString().substring(0, 19).replace('T', ' '); 

	console.log("getOrdersNotiMode comes!!!");
   let command = "SELECT *FROM orders WHERE userId=? and orderedTime >= ? and orderedTime <= ? and (orderStatus=? or orderStatus=?)" ;
   let values = [userId,yesterDayTimeStr , currentTimeStr,"paid","checked"];

   performQueryWithParam(command, values, function(err,result) {
      if(err){
         console.log(err);
         next(err);
      }else{
         console.log(result);

         let orders=[];
         result.forEach(function(order){
            decryptObj(order);
            orders.push(order);
         })

         next(null,orders);
      }
   });
};





router.updateOrderStatus=function(orderId,oldStatus, nextStatus,timeName,timeValue,cancelReason,next){
	console.log("oldStatus:"+oldStatus+" nextStatus:"+nextStatus);
                //현재 db에 저장된 주문상태,   새로 update할 주문상태
				//timeName is checkedTime, completeTime, canceledTime ...

	var command="SELECT orderStatus FROM orders WHERE orderId=?";  //orderStatus와 oldStatus 같은지 비교하기 위해 조회함. 
	var values = [orderId];

	performQueryWithParam(command, values, function(err,result) {
		if (err){
			console.error("updateOrderStatus func  Unable to query. Error:", JSON.stringify(err, null, 2));
			ext(err);
		}else{
			console.dir("[updateOrderStatus func]:"+result.info.numRows);
			if(result.info.numRows==0){
				next("not exist order");
			}else{
				console.log("updateOrderStatus func Query succeeded. "+JSON.stringify(result));
				
				values={};
				  
				//orderStatus === oldStatus 이면 update 실행. 다르면 실행x
				if(result[0].orderStatus === oldStatus || oldStatus === '' || oldStatus ===null){
					command = "UPDATE orders SET orderStatus=:nextStatus,"+timeName+"=:timeValue, cancelReason=:cancelReason WHERE orderId=:orderId";
					values.nextStatus=nextStatus,
					values.timeValue=timeValue,
					values.orderId=orderId,
					values.cancelReason=null;
					
					//cancelled 상태면 이유 넣음. 아니면 그대로 null
					if(nextStatus==='cancelled' && cancelReason !== undefined && cancelReason !== null){
               	values.cancelReason=cancelReason;
               }
				}else{
					next("incorrect old orderStatus");
				}
				
						
				performQueryWithParam(command, values, function(err,result) {
					if (err){
						console.error("updateOrderStatus func Unable to query. Error:", JSON.stringify(err, null, 2));
						next(err);
					}else{
						console.dir("[updateOrderStatus func Get MenuInfo]:"+result.info.affectedRows);
						if(result.info.affectedRows==0){
							next("can't update orders");
						}else{
							console.log("updateOrderStatus func Query succeeded. "+JSON.stringify(result[0]));
							next(null,"success");
						}
					}
				});
			}

		}	

	});			

};


router.getCashInfo=function(cashId,next){
   console.log("getCashInfo function start");

   let command = "SELECT *FROM cash WHERE cashId=?";
   let values = [cashId];

   performQueryWithParam(command, values, function(err,result) {
      if(err){
         console.log("getCashInfo function err:"+JSON.stringify(err));
         next(err);
      }else{
         if(result.info.numRows==='0'){
            next("invalidId");
         }else{
            console.log(result);
            decryptObj(result[0]);
            next(null,result[0]);
         }
      }
   });

}

router.checkCashPwd = function(cashId, password, next){
   console.log("checkCashPwd function start");

   let command = "SELECT password, salt FROM cash WHERE cashId=?";
   let values = [cashId];

   performQueryWithParam(command, values, function(err,result) {
      if(err){
         console.log("checkCashPwd function err:"+JSON.stringify(err));
         next(err);
      }else{
         if(result.info.numRows==='0'){
            next("invalid Id");
         }else{
            console.log("checkCashPwd function success");

            let secretPwd = crypto.createHash('sha256').update(password+result[0].salt).digest('hex');

            if(secretPwd === result[0].password){
               console.log("correct password");
               next(null,"correct password");
            }else{
               next("invalid Password");
            }
         }
      }
   });
}


router.updateBalanceCash=function(cashId,amount,next){

   let command = "UPDATE cash SET balance=balance+? WHERE cashId = ?";
   let values = [amount,cashId];

   performQueryWithParam(command, values, function(err,result) {
      if(err){
         console.log("updateBalanceCash function err:"+JSON.stringify(err));
         next(err);
      }else{
         console.log("updateBalanceCash:"+JSON.stringify(result));
         next(null,"success");
      }
   });

};


router.getBalanceCash = function(cashId,next){

   let command = "SELECT balance FROM cash WHERE cashId = ?";
   let values = [cashId];

   performQueryWithParam(command, values, function(err,result) {
      if(err){
         console.log("getBalanceCash function err:"+JSON.stringify(err));
         next(err);
      }else{
         console.log("getBalanceCash:"+JSON.stringify(result));
         next(null,result[0].balance);
      }
   });
}

router.insertCashList = function(cashList,next){
   let command = "INSERT INTO cash(cashTuno,cashId,userId,transactionType,amount,transactionTime, branchCode, confirm, nowBalance)"+
                  "VALUES(:cashTuno,:cashId,:userId,:transactionType,:amount,:transactionTime,:branchCode,:confirm, :nowBalance)";

   performQueryWithParam(command, cashList, function(err,result) {
      if(err){
         console.log("insertCashList function err:"+JSON.stringify(err));
         next(err);
      }else{
         console.log("insertCashList:"+JSON.stringify(result));
         next(null,"success");
      }
   });
}

router.getCashList=function(cashId,next){
   console.log("mariaDB.getCashList start!!");

   let command = "SELECT * FROM cashList WHERE cashId =?"
   let values = [cashId];

   performQueryWithParam(command, values, function(err,result){
      if(err){
         console.log("getCashList function Error:"+JSON.stringify(err));
         next(err);
      }else{
         console.log("result:"+JSON.stringify(result));
         if(result.info.numRows === '0'){
            next("invalid cashId");
         }else{
            console.log("getCashList find cashList");
            delete result.info;
            next(null,result);
         }
      }
   });
}


router.updateCashList = function(cashList,next){
   console.log("mariaDB.updateCashList start!!");

   let command = "UPDATE cashList SET transactionTime=:transactionTime, confirm=:confirm, nowBalance=:nowBalance WHERE cashTuno=:cashTuno";

   performQueryWithParam(command, cashList, function(err,result){
      if(err){
         console.log("getCashList function Error:"+JSON.stringify(err));
         next(err);
      }else{
         console.log("result:"+JSON.stringify(result));
         if(result.info.numRows === '0'){
            next("invalid cashId");
         }else{
            console.log("getCashList find cashList");
            delete result.info;
            next(null,result);
         }
      }
   });
}


router.findBranchName=function(branchName,bankName,next){
	console.log("mariaDB.findBranchName "+ branchName, "and bankName "+bankName);
	let command="SELECT code, branchName from bankInfo where branchName LIKE _utf8 \'"+branchName+"%\' and bankName _utf8 LIKE \'"+bankName+"%\'";

	performQuery(command,function(err, result) {
      if (err){
         console.log("findBranchName Error:"+JSON.stringify(err));
         next(err);
      }else{
         console.log("result:"+JSON.stringify(result));
         if(result.info.numRows === '0'){
            next(null,[]);
         }else{
            console.dir("findBranchName result:"+result.info.numRows);
            delete result.info;
            next(null,result);
         }
      }
	});
}


router.getDepositedCash = function(cashList,next){
   console.log("mariaDB.getDepositedCash start!!");

   cashList.depositMemo = encryption(depositMemo,config.cPwd);
   let command = "SELECT * FROM cashList WHERE cashId =:depositMemo and amount=:amount and branchCode=:branchCode and transactionTime LIKE \'"+cashList.depositDate+"%\'";

   performQueryWithParam(command, cashList, function(err,result){
      if(err){
         console.log("getCashList function Error:"+JSON.stringify(err));
         next(err);
      }else{
         console.log("result:"+JSON.stringify(result));
         if(result.info.numRows === '0'){
            next("incorrect depositor");
         }else{
            console.log("getDepositedCash find cashList");
            next(null,result[0]);
         }
      }
   });
}



router.getPushIdWithCashId = function(cashId,next){
   let command = "SELECT pushId, platform FROM userInfo LEFT JOIN cash ON userInfo.userId=cash.userId WHERE cashId=?";
   let values = [cashId];

   performQueryWithParam(command, cashInfo, function(err,result){
      if(err){
         console.log("getPushIdWithCashId function Error:"+JSON.stringify(err));
         next(err);
      }else{
         console.log("result:"+JSON.stringify(result));
         if(result.info.numRows === '0'){
            next(null,"incorrect cashId");
         }else{
            console.log("getPushIdWithCashId function success");
            next(null,result[0]);
         }
      }
   });
}

router.getBankName = function(branchCode, next){
   console.log("getBankName start");
   let command = "SELECT bankName, branchName FROM bankInfo WHERE code=?";
   let values = [branchCode];

   performQueryWithParam(command, cashInfo, function(err,result){
      if(err){
         console.log("getBankName function Error:"+JSON.stringify(err));
         next(err);
      }else{
         console.log("getBankName result:"+JSON.stringify(result));
         if(result.info.numRows === '0'){
            next("incorrect branchCode");
         }else{
            console.log("getBankName function success");
            next(null,result[0]);
         }
      }
   });
};



module.exports = router;
