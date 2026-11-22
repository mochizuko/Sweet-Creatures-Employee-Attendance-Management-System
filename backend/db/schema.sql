-- MySQL dump 10.13  Distrib 8.0.44, for Win64 (x86_64)
--
-- Host: localhost    Database: sweet_creatures
-- ------------------------------------------------------
-- Server version	8.0.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `attendance_photo`
--

DROP TABLE IF EXISTS `attendance_photo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_photo` (
  `photo_id` int NOT NULL AUTO_INCREMENT,
  `record_id` int NOT NULL,
  `photo_url` varchar(255) NOT NULL,
  `captured_at` datetime NOT NULL,
  `photo_type` enum('TimeIn','TimeOut') NOT NULL,
  PRIMARY KEY (`photo_id`),
  KEY `fk_attendance_photo_record_id` (`record_id`),
  CONSTRAINT `fk_attendance_photo_record_id` FOREIGN KEY (`record_id`) REFERENCES `attendance_record` (`record_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `attendance_policy`
--

DROP TABLE IF EXISTS `attendance_policy`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_policy` (
  `policy_id` int NOT NULL AUTO_INCREMENT,
  `grace_period_minutes` int NOT NULL DEFAULT '0',
  `overtime_threshold_hours` decimal(4,2) NOT NULL DEFAULT '8.00',
  `late_rule` varchar(100) NOT NULL,
  `undertime_rule` varchar(100) NOT NULL,
  `overtime_rule` varchar(100) NOT NULL,
  `effective_date` date NOT NULL,
  `updated_by_user_id` int NOT NULL,
  PRIMARY KEY (`policy_id`),
  KEY `fk_attendance_policy_updated_by_user_id` (`updated_by_user_id`),
  CONSTRAINT `fk_attendance_policy_updated_by_user_id` FOREIGN KEY (`updated_by_user_id`) REFERENCES `user` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `attendance_record`
--

DROP TABLE IF EXISTS `attendance_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_record` (
  `record_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `attendance_date` date NOT NULL,
  `time_in` time DEFAULT NULL,
  `time_out` time DEFAULT NULL,
  `break_start` time DEFAULT NULL,
  `return_from_break` time DEFAULT NULL,
  `total_hours_worked` decimal(5,2) DEFAULT NULL,
  `overtime_hours` decimal(5,2) NOT NULL DEFAULT '0.00',
  `undertime_hours` decimal(5,2) NOT NULL DEFAULT '0.00',
  `status` enum('OnTime','Late','Flagged','Approved') NOT NULL DEFAULT 'OnTime',
  `reviewed_by_user_id` int DEFAULT NULL,
  PRIMARY KEY (`record_id`),
  UNIQUE KEY `uq_attendance_record_user_id_attendance_date` (`user_id`,`attendance_date`),
  KEY `fk_attendance_record_reviewed_by_user_id` (`reviewed_by_user_id`),
  CONSTRAINT `fk_attendance_record_reviewed_by_user_id` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_attendance_record_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `attendance_sync`
--

DROP TABLE IF EXISTS `attendance_sync`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_sync` (
  `sync_id` int NOT NULL AUTO_INCREMENT,
  `record_id` int NOT NULL,
  `sync_timestamp` datetime DEFAULT NULL,
  `offline_captured` tinyint(1) NOT NULL DEFAULT '0',
  `sync_status` enum('Pending','Synced','Failed') NOT NULL DEFAULT 'Pending',
  `flagged_for_review` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`sync_id`),
  KEY `fk_attendance_sync_record_id` (`record_id`),
  CONSTRAINT `fk_attendance_sync_record_id` FOREIGN KEY (`record_id`) REFERENCES `attendance_record` (`record_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cash_advance`
--

DROP TABLE IF EXISTS `cash_advance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cash_advance` (
  `cash_advance_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `cutoff_id` int NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `date_granted` date NOT NULL,
  `status` enum('Pending','Deducted') NOT NULL DEFAULT 'Pending',
  `recorded_by_user_id` int NOT NULL,
  PRIMARY KEY (`cash_advance_id`),
  KEY `fk_cash_advance_user_id` (`user_id`),
  KEY `fk_cash_advance_cutoff_id` (`cutoff_id`),
  KEY `fk_cash_advance_recorded_by_user_id` (`recorded_by_user_id`),
  CONSTRAINT `fk_cash_advance_cutoff_id` FOREIGN KEY (`cutoff_id`) REFERENCES `payslip_cutoff` (`cutoff_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_advance_recorded_by_user_id` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `user` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_cash_advance_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payslip`
--

DROP TABLE IF EXISTS `payslip`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payslip` (
  `payslip_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `cutoff_id` int NOT NULL,
  `days_worked` int NOT NULL,
  `total_hours_worked` decimal(7,2) NOT NULL,
  `gross_pay` decimal(10,2) NOT NULL,
  `cash_advance_deduction` decimal(10,2) NOT NULL DEFAULT '0.00',
  `net_pay` decimal(10,2) NOT NULL,
  `overtime_hours` decimal(7,2) NOT NULL DEFAULT '0.00',
  `undertime_hours` decimal(7,2) NOT NULL DEFAULT '0.00',
  `hourly_rate` decimal(10,2) NOT NULL,
  `status` enum('Draft','Finalized') NOT NULL DEFAULT 'Draft',
  `finalized_by_user_id` int DEFAULT NULL,
  PRIMARY KEY (`payslip_id`),
  UNIQUE KEY `uq_payslip_user_id_cutoff_id` (`user_id`,`cutoff_id`),
  KEY `fk_payslip_cutoff_id` (`cutoff_id`),
  KEY `fk_payslip_finalized_by_user_id` (`finalized_by_user_id`),
  CONSTRAINT `fk_payslip_cutoff_id` FOREIGN KEY (`cutoff_id`) REFERENCES `payslip_cutoff` (`cutoff_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_payslip_finalized_by_user_id` FOREIGN KEY (`finalized_by_user_id`) REFERENCES `user` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_payslip_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payslip_cutoff`
--

DROP TABLE IF EXISTS `payslip_cutoff`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payslip_cutoff` (
  `cutoff_id` int NOT NULL AUTO_INCREMENT,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `status` varchar(45) NOT NULL DEFAULT 'Open',
  PRIMARY KEY (`cutoff_id`),
  UNIQUE KEY `uq_payslip_cutoff_start_date_end_date` (`start_date`,`end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sop_document`
--

DROP TABLE IF EXISTS `sop_document`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sop_document` (
  `sop_id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(150) NOT NULL,
  `content` text NOT NULL,
  `version` varchar(20) NOT NULL DEFAULT '1.0',
  `updated_by_user_id` int NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`sop_id`),
  KEY `fk_sop_document_updated_by_user_id` (`updated_by_user_id`),
  CONSTRAINT `fk_sop_document_updated_by_user_id` FOREIGN KEY (`updated_by_user_id`) REFERENCES `user` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user`
--

DROP TABLE IF EXISTS `user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `account_role` enum('Admin','Staff') NOT NULL,
  `first_name` varchar(45) NOT NULL,
  `middle_name` varchar(45) DEFAULT NULL,
  `last_name` varchar(45) NOT NULL,
  `username` varchar(45) NOT NULL,
  `email` varchar(100) NOT NULL,
  `pin_hash` varchar(255) NOT NULL,
  `job_position` varchar(45) DEFAULT NULL,
  `hourly_rate` decimal(10,2) DEFAULT NULL,
  `account_status` enum('Active','Locked') NOT NULL DEFAULT 'Active',
  `failed_pin_attempts` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uq_user_username` (`username`),
  UNIQUE KEY `uq_user_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Default development administrator
--

INSERT IGNORE INTO `user`
  (`account_role`, `first_name`, `last_name`, `username`, `email`, `pin_hash`)
VALUES
  ('Admin', 'Admin', 'User', 'lysa', 'lysa@example.com', '$2b$10$bbxqb5bZLCatbVi/tpdi0eGBsV8XfQ.EsaRLMtOfAt94OUZPvKaIe');
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-17 20:25:52
