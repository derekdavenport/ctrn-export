# ctrn-export

Export a CTRN directory to vcards

## Parameters

1. subdomain  
Required. This is the part before `ctrn.co`. http://***subdomain***.ctrn.co
2. filename of image to ignore  
Optional. This is the filename of the image used for people without an image.
3. maximum file size  
Optional. Defaults to 15 MB. Files will be split to prevent any from exceeding this file size. Google Contacts cannot import files over 15 MB.
4. limit  
Optional. Defaults to 1000. Maximum number of people to download.

## Google Contacts

[import instructions](https://support.google.com/contacts/answer/1069522)

Note: Google Contacts import requires 3rd party cookies to be enabled.  
[cookie instructions](https://support.google.com/chrome/answer/95647)