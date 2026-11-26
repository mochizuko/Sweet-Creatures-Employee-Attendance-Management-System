# Sweet Creatures Employee Attendance Management System 

## Run the app locally

1. Create a development MySQL schema named `sweet_creatures` and apply `database/schema.sql` to an empty schema. The dump contains `DROP TABLE` statements; do not run it against a database with data you need to keep.
2. In `backend`, copy `.env.example` to `.env` and set your local MySQL credentials and a private JWT secret.
3. From the `backend` directory, install dependencies with `npm ci`.
4. Start the app with `npm start` and open `http://localhost:5000`.

The login and Staff page use the backend. Attendance, payroll, cash advances, policies, and SOP are still prototype-only and use browser data.

In Explorer, open backend\src\server.js.
Choose Run → Start Debugging (or press F5). If prompted, select Node.js.
Leave it running, then open http://localhost:5000. Stopping the debugger will stop the app.

## Test Account
Admin
username: admin@master1#
password: 040224

Staff
username: kaye
password: 123654

username: grace
password: 123654

username: trishia
password: 123654

username: lysa.pido
password: 123654


