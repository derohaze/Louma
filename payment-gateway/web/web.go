// Package web embeds the server-rendered hosted checkout page so the
// gateway stays a single binary. The page has zero JavaScript; all
// merchant-controlled values are escaped by html/template at render time.
package web

import (
	"embed"
	"html/template"
)

//go:embed checkout/page.html checkout/logo.png
var files embed.FS

var CheckoutTemplate = template.Must(template.ParseFS(files, "checkout/page.html"))
var Logo, _ = files.ReadFile("checkout/logo.png")
