# Deployment Guide

## Deploy to Render

### Option 1: Using render.yaml (Recommended)

1. **Push your code to GitHub**
   ```bash
   cd connect-four-server
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Connect to Render**
   - Go to https://render.com
   - Sign up or log in
   - Click "New +" → "Blueprint"
   - Connect your GitHub repository
   - Render will automatically detect `render.yaml`
   - Click "Apply"

### Option 2: Manual Setup

1. **Create Web Service**
   - Go to https://dashboard.render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

2. **Configure Settings**
   - **Name**: connect-four-server
   - **Environment**: Node
   - **Region**: Oregon (or closest to you)
   - **Branch**: main
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start:prod`
   - **Plan**: Free

3. **Environment Variables**
   - Add `NODE_ENV` = `production`
   - `PORT` will be automatically set by Render

4. **Deploy**
   - Click "Create Web Service"
   - Wait for deployment to complete

### After Deployment

1. **Get your server URL**
   - Example: `https://connect-four-server.onrender.com`

2. **Update Frontend**
   - Edit `connect-four/src/hooks/useSocket.ts`
   - Change `SOCKET_URL` to your Render URL:
   ```typescript
   const SOCKET_URL = 'https://connect-four-server.onrender.com';
   ```

3. **Deploy Frontend**
   - See frontend deployment options below

## Deploy Frontend

### Option 1: Vercel (Recommended)

```bash
cd connect-four
npm install -g vercel
vercel
```

### Option 2: Netlify

```bash
cd connect-four
npm run build
# Drag and drop the 'dist' folder to Netlify
```

### Option 3: Render Static Site

1. Go to Render Dashboard
2. Click "New +" → "Static Site"
3. Connect repository
4. **Build Command**: `npm run build`
5. **Publish Directory**: `dist`

## Important Notes

### Free Tier Limitations

- **Render Free Tier**: Server spins down after 15 minutes of inactivity
- **First request**: May take 30-60 seconds to wake up
- **WebSocket connections**: May disconnect during spin-down

### Production Considerations

For production use, consider:
- Upgrading to Render paid plan ($7/month) for always-on service
- Adding Redis for persistent game state
- Implementing reconnection logic
- Adding rate limiting
- Setting up monitoring

## Environment Variables

### Backend
- `PORT` - Server port (auto-set by Render)
- `NODE_ENV` - Set to 'production'

### Frontend
Update `SOCKET_URL` in `src/hooks/useSocket.ts` to your deployed backend URL

## Troubleshooting

### Build Fails
- Check that all dependencies are in `dependencies` not `devDependencies`
- Verify `nest build` runs locally
- Check Render build logs

### WebSocket Connection Fails
- Verify CORS is enabled in backend
- Check that frontend URL is using `https://` not `http://`
- Ensure WebSocket URL matches backend URL

### Server Spins Down
- Upgrade to paid plan, or
- Use a service like UptimeRobot to ping your server every 5 minutes
- Implement a "wake-up" endpoint

## Testing Deployment

1. Open your deployed frontend URL
2. Click "Online Multiplayer"
3. Create a room
4. Open another browser/device
5. Join the room with the code
6. Play!

## Cost Estimate

- **Free**: Both frontend and backend on free tiers
- **Paid**: ~$7/month for always-on backend
- **Recommended**: Start free, upgrade if needed
