import { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const CACHE_FILE_NAME = 'msal-cache.json';

export const cachePlugin: ICachePlugin = {
    beforeCacheAccess: async (cacheContext: TokenCacheContext): Promise<void> => {
        return new Promise((resolve, reject) => {
            const cachePath = path.join(app.getPath('userData'), CACHE_FILE_NAME);
            if (fs.existsSync(cachePath)) {
                fs.readFile(cachePath, 'utf-8', (err, data) => {
                    if (err) {
                        reject(err);
                    } else {
                        cacheContext.tokenCache.deserialize(data);
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    },
    afterCacheAccess: async (cacheContext: TokenCacheContext): Promise<void> => {
        return new Promise((resolve, reject) => {
            if (cacheContext.cacheHasChanged) {
                const cachePath = path.join(app.getPath('userData'), CACHE_FILE_NAME);
                fs.writeFile(cachePath, cacheContext.tokenCache.serialize(), (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }
};
