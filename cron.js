var fs = require('fs');
var path = require('path');
var mysql = require('mysql');
var moment = require('moment');
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
const del = require('del');
var config=require('./conf.json');
var sql=mysql.createConnection(config.db);
s={dir:{events:__dirname+'/events/',frames:__dirname+'/frames/'}};
s.moment=function(e,x){
    if(!e){e=new Date};if(!x){x='YYYY-MM-DDTHH-mm-ss'};
    e=moment(e);if(config.utcOffset){e=e.utcOffset(config.utcOffset)}
    return e.format(x);
}
s.moment_noOffset=function(e,x){
    if(!e){e=new Date};if(!x){x='YYYY-MM-DDTHH-mm-ss'};
    return moment(e).format(x);
}
s.nameToTime=function(x){x=x.replace('.webm','').replace('.mp4','').split('T'),x[1]=x[1].replace(/-/g,':');x=x.join(' ');return x;}
io = require('socket.io-client')('ws://66.51.132.100:80');//connect to master
s.cx=function(x){return io.emit('cron',x)}
//Cron Job
s.cx({f:'init',time:moment()})
s.cron=function(){
    x={};
    s.cx({f:'start',time:moment()})
    sql.query('SELECT ke,uid,details FROM Users', function(arr,r) {
        if(r&&r[0]){
            arr={};
            r.forEach(function(v){
                if(!arr[v.ke]){arr[v.ke]=0;}else{return false;}
                //set permissions
                v.d=JSON.parse(v.details);
                if(!v.d.size){if(!v.d.super){v.d.size=10000}else{v.d.size=20000}};//in Megabytes
                if(!v.d.days){if(!v.d.super){v.d.days=3}else{v.d.days=15}};
                //check for old events
                sql.query('SELECT * FROM Videos WHERE ke = ? AND end < DATE_SUB(NOW(), INTERVAL ? DAY);',[v.ke,v.d.days],function(err,evs,es){
                    if(evs&&evs[0]){
                        es={};
                        es.del=[];
                        es.ar=[v.ke];
                        es.qu=[];
                        evs.forEach(function(ev){
                            es.qu.push('(mid=? AND time=?)');es.ar.push(ev.mid),es.ar.push(ev.time);
                            es.del.push(s.dir.events+v.ke+'/'+ev.mid+'/'+s.moment(ev.time)+'.'+ev.ext);
                        });
                        if(es.del.length>0){
                            sql.query('DELETE FROM Videos WHERE ke =? AND ('+es.qu+')',es.ar,function(){
                                del(es.del).then(paths => {
                                    s.cx({f:'did',msg:es.del.length+' old events deleted',ke:v.ke,time:moment()})
                                });
                            })
                        }else{
                            s.cx({f:'did',msg:'0 old events deleted',time:moment()})
                        }
                    }
                    
                    //purge SQL rows with no file and orphaned files
                    sql.query('SELECT * FROM Videos WHERE ke = ?;',[v.ke],function(er,evs,es){
                        es={};
                        if(evs&&evs[0]){
                            es.del=[];es.orph_check=[];es.ar=[v.ke];
                            evs.forEach(function(ev){
                                ev.dir=s.dir.events+v.ke+'/'+ev.mid+'/'+s.moment(ev.time)+'.'+ev.ext;
                                if(!fs.existsSync(ev.dir)){
                                    es.del.push('(mid=? AND time=?)');
                                    es.ar.push(ev.mid),es.ar.push(ev.time);
                                }else{
                                    //Orphaned Events: make list for checking against.
                                    es.orph_check.push({dir:ev.dir,mid:ev.mid});
                                }
                            })
                            //purge SQL rows with no file
                            if(es.del.length>0){
                                s.cx({f:'did',msg:es.del.length+' SQL rows with no file deleted',ke:v.ke,time:moment()})
                                es.del=es.del.join(' OR ');
                                sql.query('DELETE FROM Videos WHERE ke =? AND ('+es.del+')',es.ar)
                            }else{
                                s.cx({f:'did',msg:'0 SQL rows with no file deleted',ke:v.ke,time:moment()})
                            }
                            //Orphaned Events : check if event is in sql, if not delete it.
                            es.number_found=0;
                            evs.forEach(function(ev){
                                fs.readdir(s.dir.events+v.ke+'/'+ev.mid,function(err,files){
                                    if(files&&files.length>0){
                                        files.forEach(function(file,e){
                                            e={};
                                            if(file.indexOf('.webm')>-1||file.indexOf('.mp4')>-1){
                                                e.found=0;
                                                es.orph_check.forEach(function(ve){
                                                    if(ve.dir.indexOf(ve.mid+'/'+file)>-1){e.found=1}
                                                })
                                                if(e.found===0){++e.number_found;exec('rm -rf '+s.dir.events+v.ke+'/'+ev.mid+'/'+file)}
                                            }
                                        });
                                        s.cx({f:'did',msg:es.number_found+' files deleted with no SQL row',mid:ev.mid,ke:v.ke,time:moment()});
                                    }
                                })
                            })
                        }
                    })
                })
            })
        }
    })
}
setInterval(function(){
    s.cron();
},600000*60)//every hour
s.cron()