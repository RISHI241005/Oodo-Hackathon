# Human Resource Management System

Full-stack HRMS built from the supplied PDF requirements. It includes:

- Sign up and sign in with role-based access.
- Employee and Admin/HR dashboards.
- Employee profiles with limited employee edits and full admin edits.
- Daily attendance check-in/check-out plus admin attendance management.
- Leave application and live admin approval/rejection.
- Payroll visibility for employees and salary updates for admins.
- Direct profile photo upload from the laptop.
- MySQL schema creation and seed data on server startup.

## Requirements

- Node.js 18+
- MySQL running locally
- MySQL user: `root`
- MySQL password configured in `.env`

## Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

The server creates database `hrms_live` and all required tables automatically.

## Test Accounts

```text
Admin/HR
Email: admin@hrms.local
Password: Admin@12345

Employee
Email: employee@hrms.local
Password: Employee@12345
```

## MySQL

The schema is also available in `database/schema.sql` if you want to inspect or run it manually.

Update database settings in `.env`.

`APP_TIMEZONE=Asia/Kolkata` controls the real-world day and time used for check-in/check-out.
