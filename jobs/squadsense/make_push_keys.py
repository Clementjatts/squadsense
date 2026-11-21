"""Makes the key pair that phone and browser notifications need (VAPID keys).

Run once, from jobs/:

    python -m squadsense.make_push_keys

It prints two lines. The public key goes to Vercel as
NEXT_PUBLIC_VAPID_PUBLIC_KEY, so the website can subscribe your devices.
The private key goes to GitHub as the VAPID_PRIVATE_KEY secret, so the
sync can send to them. Keep the private key secret; making a new pair
means turning alerts on again on every device.
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def url_safe(data):
    """Base64 with URL-safe letters and no padding, the format web push uses."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_keys():
    """A new P-256 key pair as (public, private), both in web push's text format."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    private = private_key.private_numbers().private_value.to_bytes(32, "big")
    public = private_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return url_safe(public), url_safe(private)


def main():
    public, private = make_keys()
    print(f"NEXT_PUBLIC_VAPID_PUBLIC_KEY (Vercel): {public}")
    print(f"VAPID_PRIVATE_KEY (GitHub secret):    {private}")


if __name__ == "__main__":
    main()
