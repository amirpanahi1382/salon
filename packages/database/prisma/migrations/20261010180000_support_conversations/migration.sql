-- One support conversation per salon user. Messages are immutable text facts.
-- They do not reference or modify customer messaging or VIP requests.

CREATE TABLE "support_conversations" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL,
    "awaiting_support_reply" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_conversations_user_id_key" ON "support_conversations"("user_id");
CREATE UNIQUE INDEX "support_conversations_user_id_salon_id_key" ON "support_conversations"("user_id", "salon_id");
CREATE UNIQUE INDEX "support_conversations_id_salon_id_key" ON "support_conversations"("id", "salon_id");
CREATE INDEX "support_conversations_last_message_at_id_idx" ON "support_conversations"("last_message_at" DESC, "id" DESC);

ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_user_id_salon_id_fkey" FOREIGN KEY ("user_id", "salon_id") REFERENCES "users"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "author_user_id" UUID,
    "author_platform_admin_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_messages_author_xor_chk" CHECK (
        ("author_user_id" IS NOT NULL AND "author_platform_admin_id" IS NULL)
        OR ("author_user_id" IS NULL AND "author_platform_admin_id" IS NOT NULL)
    ),
    CONSTRAINT "support_messages_body_length_chk" CHECK (
        char_length("body") >= 1 AND char_length("body") <= 2000
    )
);

CREATE INDEX "support_messages_conversation_id_created_at_id_idx" ON "support_messages"("conversation_id", "created_at" DESC, "id" DESC);

ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversation_id_salon_id_fkey" FOREIGN KEY ("conversation_id", "salon_id") REFERENCES "support_conversations"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_salon_id_fkey" FOREIGN KEY ("author_user_id", "salon_id") REFERENCES "users"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_platform_admin_id_fkey" FOREIGN KEY ("author_platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
