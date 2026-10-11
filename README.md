# B.S.M.P School - Smart Student & School Portal 🏫

A modern, responsive full-stack School Web Application built with **HTML5, CSS3, JavaScript, Node.js, and npm** (Express & Socket.IO), featuring **separate dedicated portals for Students and Faculty Administrators**, **complete login security**, and **Dark/Light theme switcher**.

---

## 🌐 Dedicated Portal URLs

| Portal | URL | Access Credentials |
| :--- | :--- | :--- |
| **🔒 Student Portal** | **[http://localhost:3000/](http://localhost:3000/)** | Roll No: `10A-01`<br>Password: `password123`<br>*(Or click "Sign Up" to create a new account)* |
| **🛡️ Teacher & Admin Portal** | **[http://localhost:3000/admin](http://localhost:3000/admin)** | Email: `admin@school.edu`<br>Password: `admin123` |

---

## 🌟 Key Features

### 1. 🔒 Student Portal (`/`)
- **Login Security Gate**: Students must authenticate using their **Roll Number / Email** and **Password** to access academic records.
- **Self Registration**: New students register into the fixed Grade 8 class and choose Section A, B, C, or D; students cannot change the grade during sign-up. Faculty can still assign other grades when enrolling students from the admin portal.
- **📲 Phone Push Notifications**: Students can opt in from the dashboard to receive a private push alert when a new official notice is posted, even when the portal is closed. The VAPID key pair is generated once and stored in the ignored `data/web-push-keys.json` file.
- **💬 Real-Time Student Chat**: Channel messaging (`#general`, `#math-doubts`, `#announcements`) with live updates, edit/delete controls for your own messages, student message reporting, clear Teacher/Student role labels, a searchable full emoji picker, and document (3 MB), image (10 MB), and video (20 MB) attachments. All Subjects Doubts uses a one-minute per-student send cooldown.
- **📅 Attendance Tracking**: Student-specific present/absent totals and attendance percentage, duplicate-safe self check-in, subject breakdown table, and leave application request modal. Faculty attendance marks update an existing student/date record instead of creating conflicting entries.
- **🌴 Holidays Calendar**: Countdown timer to next holiday with category filters (Festivals, Vacations, Gazetted).
- **🤝 PTM Meeting Booking**: 1-on-1 appointment slot picker with teachers and past remarks review.
- **📚 Exam Datesheet**: View the admin-managed exam schedule with live updates.
- **🌙 Dark Theme**: One-click theme switcher in header with persistent preference.
- **Logout Session**: One-click logout clearing local session.

### 2. 🛡️ Dedicated Teacher & Faculty Admin Portal (`/admin`)
- **Faculty Security Gate**: Restricted to authorized faculty credentials; the default account is `admin@school.edu` / `admin123`.
- **Faculty Account Management**: Create and delete teacher or administrator accounts with individual login credentials; the signed-in and last remaining accounts are protected.
- **Student Roster & Credential Management**:
  - View all registered students, roll numbers, classes, and houses.
  - Reset student passwords on request.
  - Remove/delete student accounts.
  - Enroll new students directly from admin.
- **Daily Attendance Marker**: Select any student, choose date, set status (*Present*, *Absent*, *Late*), add remarks, and submit records live.
- **Leave Application Approvals**: 1-click **Approve** (green) and **Reject** (red) buttons for student leave requests.
- **Broadcast Live Announcements**: Publish official school circulars (*URGENT*, *ACADEMIC*, *EVENT*) which instantly appear on the student dashboard notice board and chat `#announcements`.
- **Chat Moderation**: Review student message reports in a pending queue, dismiss reports, delete reported or individual chat messages, or clear a selected channel; moderation changes update live for connected users.
- **Exam Datesheet Management**: Faculty can add, edit, and remove exam datesheet entries and set the exam/term title; updates appear live on the student Exam page.
- **PTM Feedback & Observations**: Submit academic remarks and 1-to-5 star ratings for students.
- **Manage Subjects**: Open or close syllabus editing; when open, add/remove subjects across the syllabus, exam timetable, and attendance records.
- **Manage Festivals & Holidays**: Add calendar events and remove outdated festivals or holidays from the admin portal.

---

## 🚀 How to Run the App

1. Open PowerShell or Command Prompt in the project folder:
   ```powershell
   cd C:\Users\Bedle\.gemini\antigravity\scratch\school-app
   ```

2. Start the server:
   ```powershell
   node server.js
   ```

3. Open your browser:
   - Student Portal: [http://localhost:3000/](http://localhost:3000/)
   - Teacher Admin Portal: [http://localhost:3000/admin](http://localhost:3000/admin)

For phone push notifications, serve the portal over HTTPS and open it on the phone. On iPhone/iPad, add the portal to the Home Screen and open that installed app before enabling notifications (iOS 16.4 or later). Students must tap **Enable notifications** and allow the browser prompt. Keep `data/web-push-keys.json` private and persistent across server restarts; losing it requires students to enable notifications again.

---

## 📁 Project Structure

```
school-app/
├── package.json          # Node.js dependencies (express, socket.io, cors, web-push)
├── server.js             # Express API server with auth & Socket.IO real-time backend
├── data/
│   └── store.json        # Persistent JSON data store with admins and students
└── public/
    ├── index.html        # Student Portal with login security gate
    ├── manifest.webmanifest # Installable phone portal configuration
    ├── service-worker.js # Background push notifications
    ├── icons/
    │   └── school-crest.png # School logo, favicon, and push notification icon
    ├── admin.html        # Dedicated Teacher & Admin Control Center (/admin)
    ├── css/
    │   └── style.css     # Clean responsive styling with Dark Theme support
    └── js/
        ├── app.js        # Student Portal logic, socket.io client, and auth
        └── admin.js      # Dedicated Admin portal logic and controls
```
