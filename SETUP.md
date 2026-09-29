# Putting Steady on your phone

Steady works without any of this (it saves to `data.json` when run with `node server.js`).
To use it on your phone, host it on Firebase and sign in with Google so your data syncs.

1. Go to https://console.firebase.google.com and create a project (no Analytics needed).
2. **Build > Authentication > Get started**, then enable the **Google** provider.
3. **Build > Firestore Database > Create database** (production mode, any region).
4. **Project settings > Your apps > Web (`</>`)**, register an app, and copy the `firebaseConfig` values into `firebase-config.js`
   (replace `null` with the object, as in the example in that file).
5. Deploy the rules and the site:

   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add        # pick your project
   firebase deploy
   ```

6. Open the `https://<project>.web.app` URL on your phone, sign in, then use "Add to Home Screen".

Your first sign-in uploads whatever is already on that device. After that, every device signed into the same Google account stays in sync,
and it keeps working offline and syncs when you're back.

For local testing with Firebase, add `localhost` under **Authentication > Settings > Authorized domains** (it's usually there by default).
