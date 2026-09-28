\set ON_ERROR_STOP on
-- Synthetic history fixture for a separately created disposable phase8_relations DB.
-- Apply existing migrations first. Never run on an application/preview database.
DO $$ BEGIN
  IF current_database() <> 'phase8_relations' THEN
    RAISE EXCEPTION 'Phase 8 fixture requires disposable phase8_relations database';
  END IF;
END $$;
BEGIN;
INSERT INTO salons(id,name,updated_at) VALUES
  (md5('p8-salon-a')::uuid,'Phase 8 A',now()),
  (md5('p8-salon-b')::uuid,'Phase 8 B',now());
INSERT INTO users(id,salon_id,name,email,password_hash,role,updated_at) VALUES
  (md5('p8-user-a')::uuid,md5('p8-salon-a')::uuid,'Synthetic A','p8-a@example.test','synthetic','OWNER',now()),
  (md5('p8-user-b')::uuid,md5('p8-salon-b')::uuid,'Synthetic B','p8-b@example.test','synthetic','OWNER',now());
INSERT INTO platform_admins(id,email,password_hash,name,updated_at) VALUES
  (md5('p8-admin')::uuid,'p8-admin@example.test','synthetic','Synthetic admin',now());
INSERT INTO customers(id,salon_id,first_name,last_name,phone_number,updated_at) VALUES
  (md5('p8-customer-a')::uuid,md5('p8-salon-a')::uuid,'Synthetic','A','09120000001',now()),
  (md5('p8-customer-b')::uuid,md5('p8-salon-b')::uuid,'Synthetic','B','09120000002',now());
INSERT INTO opportunity_actions(id,salon_id,customer_id,opportunity_type,status,created_by,updated_at) VALUES
  (md5('p8-action-valid')::uuid,md5('p8-salon-a')::uuid,md5('p8-customer-a')::uuid,'REACTIVATION','OPEN',md5('p8-user-a')::uuid,now()),
  (md5('p8-action-cross')::uuid,md5('p8-salon-a')::uuid,md5('p8-customer-a')::uuid,'CUSTOMER_RETURN','OPEN',md5('p8-user-b')::uuid,now());
INSERT INTO vip_target_lists(id,name,status,contact_count,created_by_admin_id,updated_at) VALUES
  (md5('p8-list')::uuid,'Synthetic list','ACTIVE',3,md5('p8-admin')::uuid,now());
INSERT INTO vip_target_contacts(id,list_id,sort_order,phone_number) VALUES
  (md5('p8-contact-1')::uuid,md5('p8-list')::uuid,1,'09120000011'),
  (md5('p8-contact-2')::uuid,md5('p8-list')::uuid,2,'09120000012'),
  (md5('p8-contact-3')::uuid,md5('p8-list')::uuid,3,'09120000013');
INSERT INTO vip_requests(id,salon_id,list_id,created_by_user_id,requested_count,geographic_range,status,reserved_until,updated_at) VALUES
  (md5('p8-vip-a')::uuid,md5('p8-salon-a')::uuid,md5('p8-list')::uuid,md5('p8-user-a')::uuid,30,'Synthetic','SUBMITTED',now()+interval '1 day',now()),
  (md5('p8-vip-cross')::uuid,md5('p8-salon-a')::uuid,md5('p8-list')::uuid,md5('p8-user-b')::uuid,30,'Synthetic','SUBMITTED',now()+interval '1 day',now()),
  (md5('p8-vip-b')::uuid,md5('p8-salon-b')::uuid,md5('p8-list')::uuid,md5('p8-user-b')::uuid,30,'Synthetic','SUBMITTED',now()+interval '1 day',now());
INSERT INTO message_requests(id,salon_id,customer_id,created_by_user_id,message_text,message_business_date,counts_toward_daily_limit,status,recipient_phone_number,updated_at) VALUES
  (md5('p8-msg-valid')::uuid,md5('p8-salon-a')::uuid,md5('p8-customer-a')::uuid,md5('p8-user-a')::uuid,'Synthetic',current_date,false,'QUEUED','09120000001',now()),
  (md5('p8-msg-cross')::uuid,md5('p8-salon-a')::uuid,md5('p8-customer-a')::uuid,md5('p8-user-b')::uuid,'Synthetic',current_date,false,'QUEUED','09120000001',now()),
  (md5('p8-msg-for-delivery')::uuid,md5('p8-salon-a')::uuid,md5('p8-customer-a')::uuid,md5('p8-user-a')::uuid,'Synthetic',current_date,false,'DISPATCHED','09120000001',now());
INSERT INTO message_requests(id,salon_id,vip_request_id,created_by_user_id,message_text,message_business_date,counts_toward_daily_limit,status,recipient_phone_number,updated_at) VALUES
  (md5('p8-vip-msg-a')::uuid,md5('p8-salon-a')::uuid,md5('p8-vip-a')::uuid,md5('p8-user-a')::uuid,'Synthetic',current_date,false,'QUEUED','09120000011',now()),
  (md5('p8-vip-msg-b')::uuid,md5('p8-salon-b')::uuid,md5('p8-vip-b')::uuid,md5('p8-user-b')::uuid,'Synthetic',current_date,false,'QUEUED','09120000012',now());
INSERT INTO message_deliveries(id,salon_id,message_request_id,customer_id,mode,channel,status,provider_request_id,created_by,updated_at) VALUES
  (md5('p8-delivery-valid')::uuid,md5('p8-salon-a')::uuid,md5('p8-msg-valid')::uuid,md5('p8-customer-a')::uuid,'MANUAL','TEXT','PENDING','p8-valid',md5('p8-user-a')::uuid,now()),
  (md5('p8-delivery-cross')::uuid,md5('p8-salon-a')::uuid,md5('p8-msg-for-delivery')::uuid,md5('p8-customer-a')::uuid,'MANUAL','TEXT','PENDING','p8-cross',md5('p8-user-b')::uuid,now());
INSERT INTO vip_request_recipients(id,vip_request_id,salon_id,sort_order,source_contact_id,phone_number,message_text,message_request_id) VALUES
  (md5('p8-recipient-valid')::uuid,md5('p8-vip-a')::uuid,md5('p8-salon-a')::uuid,1,md5('p8-contact-1')::uuid,'09120000011','Synthetic',md5('p8-vip-msg-a')::uuid),
  (md5('p8-recipient-cross')::uuid,md5('p8-vip-a')::uuid,md5('p8-salon-a')::uuid,2,md5('p8-contact-2')::uuid,'09120000012','Synthetic',md5('p8-vip-msg-b')::uuid),
  (md5('p8-recipient-null')::uuid,md5('p8-vip-a')::uuid,md5('p8-salon-a')::uuid,3,md5('p8-contact-3')::uuid,'09120000013','Synthetic',NULL);
COMMIT;
