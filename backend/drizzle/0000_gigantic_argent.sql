CREATE TYPE "public"."account_kind" AS ENUM('broker', 'exchange', 'bank', 'wallet', 'other');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('stock', 'etf', 'crypto', 'bond', 'cash');--> statement-breakpoint
CREATE TYPE "public"."fx_source" AS ENUM('frankfurter', 'nbu', 'manual');--> statement-breakpoint
CREATE TYPE "public"."price_source" AS ENUM('yahoo', 'manual');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('buy', 'sell', 'deposit', 'withdraw', 'transfer_out', 'transfer_in', 'dividend', 'coupon', 'interest', 'split', 'ticker_change', 'opening_balance');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" "account_kind" DEFAULT 'broker' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"interest_rate_percent" numeric(8, 4),
	"term_end_date" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_user_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "asset_type" NOT NULL,
	"symbol" varchar(64) NOT NULL,
	"name" varchar(255) DEFAULT '' NOT NULL,
	"currency" char(3) NOT NULL,
	"price_source" "price_source" DEFAULT 'yahoo' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_user_type_symbol_unique" UNIQUE("user_id","type","symbol"),
	CONSTRAINT "assets_cash_symbol_check" CHECK ("assets"."type" <> 'cash' OR "assets"."symbol" = "assets"."currency")
);
--> statement-breakpoint
CREATE TABLE "bond_details" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"face_value_minor" bigint NOT NULL,
	"coupon_rate_percent" numeric(8, 4) NOT NULL,
	"coupon_frequency" smallint NOT NULL,
	"issue_date" date,
	"maturity_date" date NOT NULL,
	"isin" varchar(12),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bond_freq_check" CHECK ("bond_details"."coupon_frequency" IN (0, 1, 2, 4, 12)),
	CONSTRAINT "bond_zero_coupon_check" CHECK (("bond_details"."coupon_frequency" = 0) = ("bond_details"."coupon_rate_percent" = 0)),
	CONSTRAINT "bond_face_positive_check" CHECK ("bond_details"."face_value_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_date" date NOT NULL,
	"base_ccy" char(3) NOT NULL,
	"quote_ccy" char(3) NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" "fx_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "net_worth_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"base_currency" char(3) NOT NULL,
	"total_minor" bigint NOT NULL,
	"breakdown" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"quote_date" date NOT NULL,
	"price" numeric(20, 8) NOT NULL,
	"currency" char(3) NOT NULL,
	"source" "price_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"quantity" numeric(38, 18),
	"price" numeric(20, 8),
	"amount_minor" bigint,
	"currency" char(3) NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"gross_minor" bigint,
	"withholding_tax_minor" bigint,
	"net_minor" bigint,
	"transfer_group_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tx_amount_nonneg_check" CHECK ("transactions"."amount_minor" IS NULL OR "transactions"."amount_minor" >= 0),
	CONSTRAINT "tx_qty_positive_check" CHECK ("transactions"."quantity" IS NULL OR "transactions"."quantity" > 0),
	CONSTRAINT "tx_fee_only_trade_check" CHECK ("transactions"."type" IN ('buy','sell') OR "transactions"."fee_minor" = 0),
	CONSTRAINT "tx_transfer_group_check" CHECK (("transactions"."type" IN ('transfer_out','transfer_in')) = ("transactions"."transfer_group_id" IS NOT NULL)),
	CONSTRAINT "tx_income_fields_check" CHECK (
    "transactions"."type" NOT IN ('dividend','coupon','interest')
    OR ("transactions"."gross_minor" IS NOT NULL AND "transactions"."withholding_tax_minor" IS NOT NULL
        AND "transactions"."net_minor" = "transactions"."gross_minor" - "transactions"."withholding_tax_minor")),
	CONSTRAINT "tx_trade_fields_check" CHECK (
    "transactions"."type" NOT IN ('buy','sell')
    OR ("transactions"."quantity" IS NOT NULL AND "transactions"."price" IS NOT NULL AND "transactions"."amount_minor" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_details" ADD CONSTRAINT "bond_details_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_date_pair_unique" ON "fx_rates" USING btree ("rate_date","base_ccy","quote_ccy");--> statement-breakpoint
CREATE INDEX "fx_rates_pair_date_idx" ON "fx_rates" USING btree ("base_ccy","quote_ccy","rate_date");--> statement-breakpoint
CREATE UNIQUE INDEX "nws_user_date_unique" ON "net_worth_snapshots" USING btree ("user_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "price_quotes_asset_date_unique" ON "price_quotes" USING btree ("asset_id","quote_date");--> statement-breakpoint
CREATE INDEX "tx_account_executed_idx" ON "transactions" USING btree ("account_id","executed_at");--> statement-breakpoint
CREATE INDEX "tx_asset_executed_idx" ON "transactions" USING btree ("asset_id","executed_at");--> statement-breakpoint
CREATE INDEX "tx_user_executed_idx" ON "transactions" USING btree ("user_id","executed_at");--> statement-breakpoint
CREATE INDEX "tx_type_idx" ON "transactions" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_transfer_group_type_unique" ON "transactions" USING btree ("transfer_group_id","type") WHERE transfer_group_id IS NOT NULL;