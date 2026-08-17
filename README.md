# Tourist Access Control System - Backend

This is the backend implementation for the Tourist Access Control System, built with Node.js, Express, PostgreSQL, and Prisma ORM.

## Setup Instructions

### 1. Prerequisites
- Node.js installed
- PostgreSQL database server running (local or cloud)

### 2. Configuration
1. Open the project folder (`tourist-access-backend`).
2. Copy the `.env.example` file to a new file named `.env`:
   ```bash
   cp .env.example .env
   ```
3. Update the `DATABASE_URL` in the `.env` file with your actual PostgreSQL connection string.
4. Update the `JWT_SECRET` with a secure random string.

### 3. Install Dependencies
Run the following command to install the required packages:
```bash
npm install
```

### 4. Database Initialization
Run the Prisma migration to create the tables in your PostgreSQL database:
```bash
npx prisma migrate dev --name init
```

### 5. Running the Application
To start the development server with hot-reload (nodemon):
```bash
npm run dev
```

To start the server in production mode:
```bash
npm start
```

## API Testing
Once the server is running on `http://localhost:3000`, you can start testing the APIs using cURL, Postman, or Thunder Client.

*   You must first run `POST /api/auth/register` (Note: We bypassed ADMIN check for the first ever user or you can insert directly into DB to create the first ADMIN).
*   *Alternatively, create a seeder to inject an initial ADMIN account if needed.*
*   Login via `POST /api/auth/login` to obtain the JWT token.
*   Attach the token as `Authorization: Bearer <token>` in the Headers for all protected routes.
