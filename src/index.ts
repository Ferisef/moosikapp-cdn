import Path from 'path';
import Express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import JWT from 'jsonwebtoken';
import request from 'request-promise';
import filesize from 'filesize';
import DiskManager from 'yadisk-mgr';
import UploadTargetManager, { IUploadTarget } from './utils/UploadTargetManager';
import checkAuth from './utils/authorization';
import contentTypeToExtension from './utils/contentTypeToExtension';
import asyncErrorHandler, { withAsyncErrorHandler } from './middlewares/asyncErrorHandler';
import HTTPError from './errors/HTTPError';

const { PORT, TOKEN_LIST, JWT_SECRET } = process.env;

const tokenList = JSON.parse(String(TOKEN_LIST));
const diskManager = new DiskManager(tokenList);

const uploadTargetManager = new UploadTargetManager();

const app = Express();

app.use(helmet({ hsts: false }));
app.use(cors());

app.set('view engine', 'pug');
app.set('views', Path.resolve('src/views'));

app.get('/status.json', withAsyncErrorHandler(
  async (req: Request, res: Response) => {
    const status = await diskManager.getStatus();
    res.status(200).send(status);
  },
));

app.get('*', withAsyncErrorHandler(
  async (req: Request, res: Response) => {
    const path = decodeURI(req.path);

    try {
      const uri = await diskManager.getFileLink(path);
      request(uri).pipe(res);
    } catch (e1) {
      try {
        checkAuth(req);

        const dirList = await diskManager.getDirList(path);
        res.status(200).render('dirList', {
          dirList: dirList.map((item) => {
            const basePath = `${path}${path.endsWith('/') ? '' : '/'}`;

            return {
              ...item,
              size: item.size ? filesize(item.size) : 'N/A',
              link: `${basePath}${item.name}`,
            };
          }),
        });
      } catch (e2) {
        if (e2 instanceof HTTPError) {
          throw e2;
        }

        throw new HTTPError(404, 'Not found.');
      }
    }
  },
));

app.put('/upload-target/:target', withAsyncErrorHandler(
  async (req: Request, res: Response) => {
    const jwt = <IUploadTarget>JWT.verify(req.params.target, String(JWT_SECRET));

    if (uploadTargetManager.has(jwt)) {
      throw new HTTPError(410, 'Gone.');
    }

    const { 'content-type': contentType } = req.headers;
    if (!contentType) {
      throw new HTTPError(400, 'No `Content-Type` header provided.');
    }
    const extension = contentTypeToExtension(contentType);

    uploadTargetManager.add(jwt);

    const path = await diskManager.uploadFile(req, { extension });
    res.status(201).send(path);
  },
));

app.use(asyncErrorHandler);

app.listen(Number(PORT));
