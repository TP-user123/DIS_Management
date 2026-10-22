# OpsDesk project files

- `client/`: React/Vite frontend, dashboards, tickets, operational tasks, role-scoped daily work tracker, asset desk, Excel imports, notifications and user/team administration.
- `server/`: Express API, MongoDB models, login/reset-password flow, configurable role permissions, tickets, tasks, handovers, date-range workload reports, shared asset register/history and notifications.
- `server/src/seedManager.js`: initial TCS manager bootstrap; can intentionally reset that manager password using `MANAGER_RESET_EXISTING=true`.
- `server/.env.example`: backend configuration, manager credentials, optional SMTP password-reset email settings.
- `client/.env.example`: frontend API URL.

Key frontend pages: Dashboard, Tickets, Tasks, Events, Asset desk, Work tracker/Reports, Engineer Issues, Notifications, Profile, Team, Handovers, ForgotPassword, ResetPassword.
