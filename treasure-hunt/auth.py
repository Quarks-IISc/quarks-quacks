from passlib.context import CryptContext
import uuid

# Configure bcrypt for password hashing and verification.
# Deprecated hash schemes are identified automatically.
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)


def hash_password(password: str) -> str:
    """Hash a password using the configured hashing scheme."""
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against its stored hash."""
    return pwd_context.verify(password, password_hash)


def generate_team_id() -> str:
    """Generate a unique team identifier using UUID4."""
    return str(uuid.uuid4())