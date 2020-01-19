import express, { ErrorRequestHandler } from 'express';
import bodyParser from 'body-parser';
import uuid from 'uuid/v4';

import jwt_middleware from 'express-jwt';
//import jwt from 'jsonwebtoken';

import config from './config/config';
import game_router from './game-router';
import user_router from './user-router';
import review_router from './review-router';
import list_router from './list-router';
import auth_router from './auth-router';
import ping_router from './ping-router';
import message_router from './message-router';
import screenshot_router from './screenshot-router';
import news_router from './news-router';
import report_router from './report-router';
import tag_router from './tag-router';

import { Database } from './database';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import * as Minio from 'minio';

/** Exit codes for fatal errors. */
enum ExitCode {
  /** Database initialization failed. */
  DB_INIT_FAIL = 1,
  /** S3 Object storage initialization failed. */
  S3_INIT_FAIL = 2
}

//self executing async function that allows the initialization to halt if a 
//fatal error occurs in an asynchronous function (like database init)
(async () => { 

console.log('Welcome to delfruit server 2.0!');

try {
  await Database.init();
} catch (e) {
  console.error("Database initialization failed!");
  console.error(e);
  process.exit(ExitCode.DB_INIT_FAIL);
}

console.log('Initializing express...');

const app = express();
/*app.use(function (req,res,next) {
  console.log(req.originalUrl);
  next();
});*/

app.use(bodyParser.json({type:"application/json"}));

console.log('Initializing jwt middleware...');

app.use(jwt_middleware({
  secret: config.app_jwt_secret,
  credentialsRequired: false
}));

console.log('Initializing role middleware...');

app.use((req,res,next) => {
  if (req.user) { 
    req.user.roles = ['game_update'];
  }
  next();
});

const e: ErrorRequestHandler = (err,req,res,next) => {
  if (err && err.name && err.name === 'UnauthorizedError') {
    //invalid token, jwt middleware returns more info in the err
    //but we don't want the client to see
    // message: 'jwt malformed',
    // code: 'invalid_token',
    return res.sendStatus(401);
  }

  const id = uuid();
  console.log(`severe error: id ${id}`);
  console.log(err);
  res.status(500).send({
    error: "Internal Server Error",
    id: id
  });
}
app.use(e);

console.log('Initializing routers...');

app.use('/api/games',game_router);
app.use('/api/users',user_router);
app.use('/api/reviews',review_router);
app.use('/api/lists',list_router);
app.use('/api/auth',auth_router);
app.use('/api/ping',ping_router);
app.use('/api/message',message_router);
app.use('/api/screenshots',screenshot_router);
app.use('/api/news',news_router);
app.use('/api/reports',report_router);
app.use('/api/tags',tag_router);

console.log('Initializing object storage...');

try {
  const minioClient = new Minio.Client({
    endPoint: config.s3_host,
    port: config.s3_port,
    useSSL: config.s3_ssl,
    accessKey: config.s3_access,
    secretKey: config.s3_secret
  });

  const bucketJustCreated = await new Promise((res,rej) => {
    minioClient.bucketExists(config.s3_bucket,(err,exists)=>{
      if (err) return rej(err);
      else if (exists) return res(false);
      console.log(`Bucket ${config.s3_bucket} doesn't exist, intializing.`)
      minioClient.makeBucket(config.s3_bucket, config.s3_region, (err) => {
        if (err) return rej(err);
        console.log(`Bucket ${config.s3_bucket} created successfully in ${config.s3_region}.`)
        res(true);
      });
    });
  });

  if (bucketJustCreated) {
    console.log(`Setting public read policy on ${config.s3_bucket}`)
    await new Promise((res,rej)=>{
      minioClient.setBucketPolicy(config.s3_bucket,`{
          "Version": "2012-10-17",
          "Id": "Public Access to Screenshots",
          "Statement": [
            {
              "Sid": "PublicRead",
              "Effect": "Allow",
              "Principal": "*",
              "Action": "s3:GetObject",
              "Resource": "arn:aws:s3:::${config.s3_bucket}/*"
            }
          ]
        }`,(err) => {
          if (err) return rej(err);
          else res();
        }
      );
    });
  }
} catch (e) {
  console.error("S3 initialization failed!");
  console.error(e);
  process.exit(ExitCode.S3_INIT_FAIL);
}

console.log('Initializing swagger...');

const options = {
  swaggerDefinition: {
    // Like the one described here: https://swagger.io/specification/#infoObject
    info: {
      title: 'Delicious Fruit API',
      version: '2.0.0',
      description: 'The API you should use instead of throwing your monitor out the window',
    },
    components: {
      securitySchemes: {
        bearerAuth: {       
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',  
        }
      }
    },
    openapi: "3.0.0",
    security: [{
      bearerAuth: []
    }],
    basePath: '/api',
    scheme: "http",
    host: "localhost:4201",
  },
  apis: [__dirname+'/*.ts'],
};

const specs = swaggerJsdoc(options);
app.use('/api/swagger', swaggerUi.serve, swaggerUi.setup(specs));

console.log('Starting app...');

app.listen(config.app_port,  () => {
  console.log(`Server started at localhost:${config.app_port}!`);
});

})();