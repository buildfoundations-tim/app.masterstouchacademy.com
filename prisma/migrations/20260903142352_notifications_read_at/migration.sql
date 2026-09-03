-- Read/unread for the notification bell.
--
-- One timestamp rather than a Notification table: every notice is derived from
-- a record that already exists (a booking, an order, an entitlement), so there
-- is nothing to store except when the member last looked.

ALTER TABLE "User" ADD COLUMN "notificationsReadAt" TIMESTAMP(3);
