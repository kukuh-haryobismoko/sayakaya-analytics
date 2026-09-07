-- Invite-by-email account creation: an admin now only enters an email +
-- access tabs (no username/password up front). The account is created with
-- no password and activated via an emailed link (reuses the password-reset
-- token flow in server/auth.js), so both columns must accept null until
-- activation. Login already accepts a username OR an email (server/auth.js
-- findUserByIdentifier), so a permanently-unset username is fine — email
-- becomes that account's login identifier. The unique index (not a plain
-- column constraint, since email is nullable and multiple nulls must be
-- allowed) keeps email-based lookup unambiguous.

alter table dashboard_users alter column username drop not null;
alter table dashboard_users alter column password_hash drop not null;

create unique index dashboard_users_email_key on dashboard_users (email) where email is not null;
