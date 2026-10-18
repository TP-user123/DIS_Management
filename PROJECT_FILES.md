# OpsDesk project files

- `client/`: React/Vite frontend, animated TCS-inspired login, dashboards, Excel ticket import, manual ticket entry, balanced random distribution, role-aware navigation and task history UI.
- `server/`: Express API, MongoDB models, login/reset-password flow, configurable role permissions, multi-manager support, tickets, tasks, events, notifications, analytics reports and engineer work reports.
- `server/src/seedManager.js`: initial TCS manager bootstrap; can intentionally reset that manager password using `MANAGER_RESET_EXISTING=true`.
- `server/.env.example`: backend configuration, manager credentials, optional SMTP password-reset email settings.
- `client/.env.example`: frontend API URL.

Key frontend pages: Dashboard, Tickets, Tasks, Events, Notifications, Profile, Reports, Team, Handovers, ForgotPassword, ResetPassword.
