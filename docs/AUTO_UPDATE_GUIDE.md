# Auto-Update System Guide

## Overview

Lagiote Revise is configured to automatically check GitHub Releases for new versions and update itself seamlessly.

## How It Works

### For Users
1. **Automatic Check**: The app checks for updates on startup and every hour
2. **Download**: Updates download automatically in the background
3. **Notification**: Users are notified when an update is ready
4. **Install**: Update installs on next app restart

### For Developers

#### Releasing a New Version

1. **Update Version Number**
   ```bash
   # Edit package.json and bump the version
   # Example: "version": "1.30.0" -> "1.31.0"
   ```

2. **Commit and Push to Main**
   ```bash
   git add package.json
   git commit -m "Bump version to 1.31.0"
   git push origin main
   ```

3. **GitHub Actions Takes Over**
   - The `release.yml` workflow automatically triggers
   - App is built for Windows
   - Release is published to GitHub with installers
   - Users' apps will auto-detect the new version

#### Monitoring Updates

Check the logs in the Electron console:
```
[Auto-Update] Checking for updates...
[Auto-Update] Update available
[Auto-Update] Update downloaded
```

## Configuration

### Update Interval
Currently set to check every **1 hour**. Configured in `main.js`:
```javascript
updateElectronApp({
  repo: 'TJ7755/Lagiote-revise',
  updateInterval: '1 hour',  // Change this to adjust frequency
  logger: { ... }
});
```

### Pre-release vs Stable
Currently set to **pre-release** mode in `forge.config.js`:
```javascript
publishers: [
  {
    name: '@electron-forge/publisher-github',
    config: {
      repository: { ... },
      prerelease: true  // Set to false for stable releases
    }
  }
]
```

## Troubleshooting

### Users Not Getting Updates

1. **Check GitHub Releases**: Verify releases are being created at https://github.com/TJ7755/Lagiote-revise/releases
2. **Check Version**: Ensure `package.json` version was incremented
3. **Check Logs**: Look for `[Auto-Update]` messages in the console
4. **Manual Update**: Users can always download the latest installer manually

### Build Failures

1. **Check GitHub Actions**: Go to Actions tab in GitHub
2. **View Logs**: Click on the failed workflow to see error details
3. **Common Issues**:
   - Missing dependencies
   - Node version mismatch
   - GitHub token permissions

## Update Flow Diagram

```
Developer pushes to main
    ↓
GitHub Actions triggered (release.yml)
    ↓
Build app (npm run make)
    ↓
Publish to GitHub Releases
    ↓
Create release with installers
    ↓
Users' apps check GitHub (every hour)
    ↓
Download update in background
    ↓
Notify user "Update ready"
    ↓
User restarts app
    ↓
Update installed ✓
```

## Important Notes

- **Always increment the version** in `package.json` for updates to work
- **Pre-release mode** means updates go to beta testers first
- **Squirrel.Windows** handles the update installation on Windows
- **No code signing** currently - users may see "Unknown Publisher" warning on first install
- Updates are **differential** - only changed files are downloaded

## Future Improvements

- [ ] Add code signing certificate to remove Windows warnings
- [ ] Implement update channels (beta, stable)
- [ ] Add update release notes in the app
- [ ] Support for macOS and Linux auto-updates
