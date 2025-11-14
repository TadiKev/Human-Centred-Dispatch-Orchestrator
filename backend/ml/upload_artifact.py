# upload_artifact.py
import boto3
import os
import sys

def upload_file(local_path, bucket, key, endpoint=None, access_key=None, secret_key=None):
    s3 = boto3.client("s3",
                      endpoint_url=endpoint,
                      aws_access_key_id=access_key,
                      aws_secret_access_key=secret_key)
    s3.upload_file(local_path, bucket, key)
    print("Uploaded", key)

if __name__ == "__main__":
    upload_file(sys.argv[1], os.environ.get("ML_BUCKET","models"), os.path.basename(sys.argv[1]),
                endpoint=os.environ.get("MINIO_URL"))
