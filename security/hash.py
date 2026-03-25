import bcrypt

def hash_password(password: str|bytes) -> bytes: # type: ignore
    if isinstance(password, str):
        raw_password = password.encode("utf-8")
    elif isinstance(password, bytes):
        # Prevent accidental re-hashing of an existing bcrypt hash.
        if password.startswith((b"$2a$", b"$2b$", b"$2y$")):
            return password
        raw_password = password
    else:
        raise TypeError("password must be str or bytes")

    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(raw_password, salt)
    return hashed


 

def check_password(password: str, hashed: bytes | str) -> bool:
    # if hashed is string, convert to bytes
    if isinstance(hashed, str):
        hashed = hashed.encode('utf-8')
    return bcrypt.checkpw(password.encode('utf-8'), hashed)
