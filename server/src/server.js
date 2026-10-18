import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import authRoutes from './routes/auth.js';
import caseRoutes from './routes/cases.js';
import taskRoutes from './routes/tasks.js';
import teamRoutes from './routes/team.js';
import dashboardRoutes from './routes/dashboard.js';
import ticketRoutes from './routes/tickets.js';
import eventRoutes from './routes/events.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';
import workReportRoutes from './routes/workReports.js';
import engineerIssueRoutes from './routes/engineerIssues.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'OpsDesk API' }));
app.use('/api/auth', authRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/work-reports', workReportRoutes);
app.use('/api/engineer-issues', engineerIssueRoutes);
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

const port = Number(process.env.PORT || 5000);
if (!process.env.MONGODB_URI) {
  console.error('Missing MONGODB_URI. Copy .env.example to .env and configure it.');
  process.exit(1);
}
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(port, () => console.log(`OpsDesk API listening on http://localhost:${port}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
