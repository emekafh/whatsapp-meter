# How to publish WhatsApp Meter (one-time setup)

You only need to do this ONCE. After this, anyone can download the app from your website.

## Step 1: Create the GitHub repo

Go to https://github.com/new and create a repo called `whatsapp-meter` (public).

## Step 2: Push the code

Open Terminal on your Mac, then copy-paste these commands one at a time:

```
cd ~/path/to/whatsapp-meter
git init
git add .
git commit -m "Initial release"
git remote add origin https://github.com/emekafh/whatsapp-meter.git
git branch -M main
git push -u origin main
```

(Replace `~/path/to/whatsapp-meter` with wherever this folder is on your Mac.)

## Step 3: Trigger the build

```
git tag v1.0.0
git push --tags
```

That's it. GitHub will now automatically build the Mac .dmg, Windows .zip, and Linux .tar.gz.

## Step 4: Check it worked

Go to https://github.com/emekafh/whatsapp-meter/actions — you should see a build running.
After ~5 minutes, go to https://github.com/emekafh/whatsapp-meter/releases — your download files will be there.

## Done!

Your website download buttons will now work automatically. Anyone who visits the site and clicks "Download" gets the app — no GitHub, no commands, no code.
