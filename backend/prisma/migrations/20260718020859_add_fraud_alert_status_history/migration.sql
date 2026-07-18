-- CreateTable
CREATE TABLE "FraudAlert" (
    "id" SERIAL NOT NULL,
    "alert_key" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "cajero_id" INTEGER NOT NULL,
    "nivel" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "detalle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "reviewed_by_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FraudAlert_alert_key_key" ON "FraudAlert"("alert_key");

-- CreateIndex
CREATE INDEX "FraudAlert_date_idx" ON "FraudAlert"("date");

-- CreateIndex
CREATE INDEX "FraudAlert_cajero_id_idx" ON "FraudAlert"("cajero_id");

-- CreateIndex
CREATE INDEX "FraudAlert_status_idx" ON "FraudAlert"("status");

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_cajero_id_fkey" FOREIGN KEY ("cajero_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
