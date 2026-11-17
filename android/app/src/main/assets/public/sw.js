/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-15e12b5b'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-512x512.png",
    "revision": "7940bdec21284e42fceca65ab2adaba7"
  }, {
    "url": "pwa-192x192.png",
    "revision": "7940bdec21284e42fceca65ab2adaba7"
  }, {
    "url": "icon.svg",
    "revision": "071786ecfd502d180cb09a56a3ccd3cb"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "7940bdec21284e42fceca65ab2adaba7"
  }, {
    "url": "assets/workbox-window.prod.es5-BBnX5xw4.js",
    "revision": null
  }, {
    "url": "assets/vendor-D_2DgoKh.js",
    "revision": null
  }, {
    "url": "assets/index-DjiAYhn0.js",
    "revision": null
  }, {
    "url": "assets/index---2fFd2i.css",
    "revision": null
  }, {
    "url": "assets/firebase-Cq6sPKU8.js",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "7940bdec21284e42fceca65ab2adaba7"
  }, {
    "url": "icon.svg",
    "revision": "071786ecfd502d180cb09a56a3ccd3cb"
  }, {
    "url": "pwa-192x192.png",
    "revision": "7940bdec21284e42fceca65ab2adaba7"
  }, {
    "url": "pwa-512x512.png",
    "revision": "7940bdec21284e42fceca65ab2adaba7"
  }, {
    "url": "manifest.webmanifest",
    "revision": "5021843bf2bb85d48d86dc1e1a59d430"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(/^\/(?:api\/|version\.json).*/i, new workbox.NetworkOnly(), 'GET');
  workbox.registerRoute(({
    request
  }) => request.mode === "navigate" || request.destination === "document", new workbox.NetworkFirst({
    "cacheName": "html-pages-v2",
    "networkTimeoutSeconds": 4,
    plugins: [new workbox.CacheableResponsePlugin({
      statuses: [200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
