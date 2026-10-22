import { HTTP_TRANSFER_CACHE_ORIGIN_MAP } from '@angular/common/http';
import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { API_BASE, PUBLIC_API } from './api';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

// On the VM the SSR server reaches the service on loopback, not through the public proxy.
// The transfer cache keys its answer by the public address, so the browser finds it there.
const internal = process.env['SITEREAD_API_INTERNAL'] || 'http://127.0.0.1:8787';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: API_BASE, useValue: internal },
    { provide: HTTP_TRANSFER_CACHE_ORIGIN_MAP, useValue: { [new URL(internal).origin]: new URL(PUBLIC_API).origin } },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
