-- Let retention use both indexes for its expiry-or-privacy-deletion predicate.
CREATE INDEX membership_installation ON period_membership(installation_id);
