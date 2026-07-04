CREATE DATABASE IF NOT EXISTS hrms_live CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hrms_live;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(30) NOT NULL UNIQUE,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_salt VARCHAR(64) NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  role ENUM('employee', 'hr', 'admin') NOT NULL DEFAULT 'employee',
  is_verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(40) DEFAULT '',
  address VARCHAR(255) DEFAULT '',
  department VARCHAR(120) NOT NULL DEFAULT 'People Operations',
  designation VARCHAR(120) NOT NULL DEFAULT 'Employee',
  joining_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  profile_picture VARCHAR(500) DEFAULT '',
  documents TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash VARCHAR(128) PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  work_date DATE NOT NULL,
  check_in DATETIME(3) NULL,
  check_out DATETIME(3) NULL,
  status ENUM('present', 'absent', 'half-day', 'leave') NOT NULL DEFAULT 'present',
  remarks VARCHAR(255) DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_employee_day (employee_id, work_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  leave_type ENUM('Paid', 'Sick', 'Unpaid') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  remarks VARCHAR(255) DEFAULT '',
  status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
  reviewer_comment VARCHAR(255) DEFAULT '',
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payroll (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL UNIQUE,
  basic DECIMAL(12,2) NOT NULL DEFAULT 35000,
  hra DECIMAL(12,2) NOT NULL DEFAULT 12000,
  allowances DECIMAL(12,2) NOT NULL DEFAULT 5000,
  deductions DECIMAL(12,2) NOT NULL DEFAULT 2000,
  effective_from DATE NOT NULL DEFAULT (CURRENT_DATE),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
