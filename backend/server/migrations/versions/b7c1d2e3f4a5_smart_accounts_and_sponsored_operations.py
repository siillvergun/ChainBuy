"""smart accounts and sponsored operations (ERC-4337)

Revision ID: b7c1d2e3f4a5
Revises: 10a3b33747f0
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c1d2e3f4a5"
down_revision: Union[str, Sequence[str], None] = "10a3b33747f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "smart_accounts",
        sa.Column("account", sa.String(length=42), nullable=False),
        sa.Column("owner", sa.String(length=42), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("account"),
        sa.UniqueConstraint("owner"),
    )
    op.create_table(
        "sponsored_operations",
        sa.Column("user_op_hash", sa.String(length=66), nullable=False),
        sa.Column("account", sa.String(length=42), nullable=False),
        sa.Column("tx_hash", sa.String(length=66), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("user_op_hash"),
    )
    op.create_index("ix_sponsored_operations_account", "sponsored_operations", ["account"])
    op.create_index("ix_sponsored_operations_created_at", "sponsored_operations", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_sponsored_operations_created_at", table_name="sponsored_operations")
    op.drop_index("ix_sponsored_operations_account", table_name="sponsored_operations")
    op.drop_table("sponsored_operations")
    op.drop_table("smart_accounts")
