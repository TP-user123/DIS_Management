# OpsDesk — IT Support Operations Workspace

OpsDesk is a customizable internal IT support operations app. It is not an official TCS product or endorsed service. Configure the workspace name and permissions for your organization before use.

## Stack
- Frontend: React 18, Vite, React Router, Axios, lucide-react, SheetJS
- Backend: Node.js, Express, Mongoose, MongoDB, JWT, bcryptjs

## Requirements
- Node.js 20+ and npm
- MongoDB Atlas or another reachable MongoDB deployment

## Setup (Windows PowerShell)
1. Extract the ZIP and open the `caseflow-saas-full` folder in VS Code.
2. Configure backend: `cd server`, then `Copy-Item .env.example .env`. Set `MONGODB_URI`, a long random `JWT_SECRET`, and manager bootstrap settings in `.env`. Never share or commit `.env`.
3. In `server`: run `npm install`, then `npm run seed:manager`, then `npm run dev`.
4. Open a second terminal, `cd client`, run `npm install`, then `npm run dev`.
5. Open `http://localhost:5173` and sign in using the manager credentials configured in the server `.env`.

## Ticket Excel import
The app reads the `TicketList` worksheet, or the first worksheet if `TicketList` is absent. Expected headers include `Ticket Number`, `Status`, `Solution Provider`, `Current Level`, `Logged Date`, `Item`, `Request Type`, `Priority Name`, `Description`, and `Remarks`. Ticket number is the unique key per workspace. Re-importing updates existing tickets.

## Included features
- Overview dashboard, ticket import/manual creation, assignment/distribution, ticket status tracking, aging and CSV export.
- Independent operational tasks, assignments, handover requests and activity history. TL/SL/Manager can update task status; an RE can update a task assigned to them.
- Events for teams or selected members, including edit and delete API endpoints and in-app notifications.
- Notifications, user profile/password management, team/access management, and work-report submission/analytics.
- Password reset flow and manager bootstrap script.

## Important notes
- Event edit/delete API routes are available to users with `events:manage`; check that your UI exposes these actions as needed.
- The ticket screen still contains the legacy routing controls. If your workflow requires no routing, hide/remove them in the UI and revoke `tickets:route` from role permissions before production.
- Work reports are still present in this build; converting that screen to a private one-to-one Engineer Issues workflow requires a deliberate migration of the UI and access model.
- In-app notifications are not email/SMS/push. Microsoft 365 Graph email integration is not configured in this build.
- Do not upload confidential production ticket exports unless your organization has approved the application and hosting. Before production, validate role permissions, configure HTTPS, restrict database access, rotate secrets, enable backups/monitoring, and test with approved sample data.

## Validation
After installing dependencies, run `npm run build` in `client`; run `npm start` or `npm run dev` in `server`. This archive includes source code, not `node_modules` or credentials.
