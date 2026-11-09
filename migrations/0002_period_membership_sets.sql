-- Keep dated immutable evidence for expiry; expose each retained member once.
-- Installation activity uses DISTINCT installation_id over this private view.
CREATE VIEW period_membership_sets AS
 SELECT DISTINCT period_kind, period_start, installation_id, application_instance_id
 FROM period_membership;
