#!/usr/bin/env bash
# One-time setup for .github/workflows/backup.yml, run by hand with AWS admin credentials:
#   bash scripts/backup-setup.sh
# Makes a private bucket that keeps 30 nights of dumps, and an IAM user that can only add files to it. The new key and
# a fresh passphrase go into 4me-backup.credentials.csv (gitignored, never printed) for the GitHub secrets.
set -euo pipefail

REGION=ap-southeast-1
BUCKET="4me-backups-$(openssl rand -hex 3)"
USER_NAME=4me-backup-ci
OUT=4me-backup.credentials.csv

[ -e "$OUT" ] && { echo "$OUT already exists; delete it once its values are in GitHub, then run again."; exit 1; }

aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" > /dev/null
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{ \"Sid\": \"HttpsOnly\", \"Effect\": \"Deny\", \"Principal\": \"*\", \"Action\": \"s3:*\",
    \"Resource\": [\"arn:aws:s3:::$BUCKET\", \"arn:aws:s3:::$BUCKET/*\"],
    \"Condition\": { \"Bool\": { \"aws:SecureTransport\": \"false\" } } }]
}"
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[
  {"ID":"keep-30-nights","Status":"Enabled","Filter":{"Prefix":"db/"},"Expiration":{"Days":30}},
  {"ID":"abort-unfinished-uploads","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}
]}'

aws iam create-user --user-name "$USER_NAME" > /dev/null
aws iam put-user-policy --user-name "$USER_NAME" --policy-name add-db-dumps-only --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{ \"Effect\": \"Allow\", \"Action\": \"s3:PutObject\", \"Resource\": \"arn:aws:s3:::$BUCKET/db/*\" }]
}"
read -r KEY_ID KEY_SECRET < <(aws iam create-access-key --user-name "$USER_NAME" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)

umask 077
{
  echo "name,value"
  echo "BACKUP_BUCKET (variable),$BUCKET"
  echo "BACKUP_AWS_ACCESS_KEY_ID (secret),$KEY_ID"
  echo "BACKUP_AWS_SECRET_ACCESS_KEY (secret),$KEY_SECRET"
  echo "BACKUP_PASSPHRASE (secret; also keep it in a password manager: without it no backup can be opened),$(openssl rand -base64 33)"
} > "$OUT"

echo "Bucket $BUCKET is ready. The values for GitHub are in $OUT."
