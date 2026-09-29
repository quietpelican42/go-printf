// Command oracle is the differential-test oracle for go-printf.
//
//	oracle gen -seed 1 -n 30000   random cases with Go's Sprintf output (NDJSON on stdout)
//	oracle run                    read NDJSON cases on stdin, add the Go output, write NDJSON
//
// A case is {"f": format, "fb": base64 format bytes (instead of f), "a": [args], "o": base64 output}.
// An arg is {"t": type, "v": value}: integers as decimal strings, float64/float32 as hex bit patterns,
// string/bytes as base64, bool as JSON bool, "[]T" as an array of T values, "nil" without v.
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"
)

type Arg struct {
	T string          `json:"t"`
	V json.RawMessage `json:"v,omitempty"`
}

type Case struct {
	F  string `json:"f,omitempty"`
	FB string `json:"fb,omitempty"`
	A  []Arg  `json:"a"`
	O  string `json:"o"`
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func js(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func decodeScalar(t string, raw json.RawMessage) any {
	var s string
	switch t {
	case "int", "int8", "int16", "int32", "int64":
		json.Unmarshal(raw, &s)
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			panic(err)
		}
		switch t {
		case "int":
			return int(n)
		case "int8":
			return int8(n)
		case "int16":
			return int16(n)
		case "int32":
			return int32(n)
		}
		return n
	case "uint", "uint8", "uint16", "uint32", "uint64", "uintptr":
		json.Unmarshal(raw, &s)
		n, err := strconv.ParseUint(s, 10, 64)
		if err != nil {
			panic(err)
		}
		switch t {
		case "uint":
			return uint(n)
		case "uint8":
			return uint8(n)
		case "uint16":
			return uint16(n)
		case "uint32":
			return uint32(n)
		case "uintptr":
			return uintptr(n)
		}
		return n
	case "float64":
		json.Unmarshal(raw, &s)
		n, _ := strconv.ParseUint(s, 16, 64)
		return math.Float64frombits(n)
	case "float32":
		json.Unmarshal(raw, &s)
		n, _ := strconv.ParseUint(s, 16, 32)
		return math.Float32frombits(uint32(n))
	case "string":
		json.Unmarshal(raw, &s)
		b, _ := base64.StdEncoding.DecodeString(s)
		return string(b)
	case "bytes":
		json.Unmarshal(raw, &s)
		b, _ := base64.StdEncoding.DecodeString(s)
		return b
	case "bool":
		var b bool
		json.Unmarshal(raw, &b)
		return b
	}
	panic("unknown type " + t)
}

func decodeArg(a Arg) any {
	if a.T == "nil" {
		return nil
	}
	if strings.HasPrefix(a.T, "[]") {
		var elems []json.RawMessage
		json.Unmarshal(a.V, &elems)
		et := a.T[2:]
		switch et {
		case "int":
			r := []int{}
			for _, e := range elems {
				r = append(r, decodeScalar(et, e).(int))
			}
			return r
		case "string":
			r := []string{}
			for _, e := range elems {
				r = append(r, decodeScalar(et, e).(string))
			}
			return r
		case "float64":
			r := []float64{}
			for _, e := range elems {
				r = append(r, decodeScalar(et, e).(float64))
			}
			return r
		case "float32":
			r := []float32{}
			for _, e := range elems {
				r = append(r, decodeScalar(et, e).(float32))
			}
			return r
		case "bool":
			r := []bool{}
			for _, e := range elems {
				r = append(r, decodeScalar(et, e).(bool))
			}
			return r
		case "int32":
			r := []int32{}
			for _, e := range elems {
				r = append(r, decodeScalar(et, e).(int32))
			}
			return r
		case "uint16":
			r := []uint16{}
			for _, e := range elems {
				r = append(r, decodeScalar(et, e).(uint16))
			}
			return r
		}
		panic("unknown slice type " + a.T)
	}
	return decodeScalar(a.T, a.V)
}

func eval(c *Case) {
	var f string
	if c.FB != "" {
		b, _ := base64.StdEncoding.DecodeString(c.FB)
		f = string(b)
	} else {
		f = c.F
	}
	args := make([]any, len(c.A))
	for i, a := range c.A {
		args[i] = decodeArg(a)
	}
	c.O = b64([]byte(fmt.Sprintf(f, args...)))
}

// ---- generator ----

type gen struct{ r *rand.Rand }

func (g *gen) pick(s []string) string { return s[g.r.Intn(len(s))] }

var intTypes = []string{"int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr"}

func (g *gen) intArg(t string) Arg {
	signed := t[0] == 'i'
	bits := 64
	switch t {
	case "int8", "uint8":
		bits = 8
	case "int16", "uint16":
		bits = 16
	case "int32", "uint32":
		bits = 32
	}
	var s string
	if signed {
		max := int64(math.MaxInt64) >> (64 - bits)
		min := -max - 1
		var v int64
		switch g.r.Intn(6) {
		case 0:
			v = []int64{0, 1, -1, 7, 42, -42, 255, 65, 4096, max, min}[g.r.Intn(11)]
			if v > max {
				v = max
			}
			if v < min {
				v = min
			}
		case 1:
			v = int64(g.r.Intn(200)) - 100
		case 2:
			v = int64(g.r.Uint64()) >> uint(g.r.Intn(bits+1)) >> (64 - bits) << (64 - bits) >> (64 - bits)
			if bits < 64 {
				v = int64(g.r.Uint64()) >> (64 - bits)
			}
		case 3: // runes
			v = int64(g.rune())
		default:
			v = int64(g.r.Uint64()) >> uint(64-bits+g.r.Intn(bits))
			if v > max {
				v = max
			}
			if v < min {
				v = min
			}
		}
		s = strconv.FormatInt(v, 10)
	} else {
		max := uint64(math.MaxUint64) >> (64 - bits)
		var v uint64
		switch g.r.Intn(5) {
		case 0:
			v = []uint64{0, 1, 7, 42, 255, 65, 4096, max}[g.r.Intn(8)]
			if v > max {
				v = max
			}
		case 1:
			v = uint64(g.r.Intn(300))
			if v > max {
				v = max
			}
		case 2:
			v = uint64(g.rune())
			if v > max {
				v = max
			}
		default:
			v = g.r.Uint64() >> uint(64-bits+g.r.Intn(bits))
			if v > max {
				v = max
			}
		}
		s = strconv.FormatUint(v, 10)
	}
	return Arg{T: t, V: js(s)}
}

func (g *gen) rune() int32 {
	switch g.r.Intn(8) {
	case 0:
		return int32(g.r.Intn(0x80))
	case 1:
		return int32(g.r.Intn(0x800))
	case 2:
		return int32(g.r.Intn(0x10000))
	case 3:
		return int32(g.r.Intn(0x110000))
	case 4:
		return int32(0xD800 + g.r.Intn(0x800)) // surrogates
	case 5:
		return []int32{-1, 0x110000, 0x10FFFF, 0xFFFD, 0xFEFF, 0xAD, 0x85, 0xA0, 0x2028, 0x7F, 0x1F600, math.MaxInt32, math.MinInt32}[g.r.Intn(13)]
	case 6:
		return int32(0xE000 + g.r.Intn(0x1000)) // private use
	}
	return int32(0x20 + g.r.Intn(0x60))
}

func (g *gen) float64bits() uint64 {
	switch g.r.Intn(10) {
	case 0:
		return []uint64{0, 1 << 63, 0x7FF0000000000000, 0xFFF0000000000000, 0x7FF8000000000001, 0xFFF8000000000000, 1, 0x7FEFFFFFFFFFFFFF, 0x0010000000000000, 0x000FFFFFFFFFFFFF}[g.r.Intn(10)]
	case 1:
		return math.Float64bits(float64(g.r.Intn(2000)-1000) / 8)
	case 2:
		return math.Float64bits(math.Pow(10, float64(g.r.Intn(60)-30)))
	case 3:
		return math.Float64bits(float64(g.r.Intn(1000000)) / math.Pow(10, float64(g.r.Intn(8))))
	case 4:
		return math.Float64bits(math.Ldexp(float64(g.r.Int63n(1<<53)), g.r.Intn(200)-150))
	case 5:
		return math.Float64bits([]float64{0.5, 1.5, 2.5, 3.5, 0.125, 0.375, 1e21, 1e20, 999999.5, 1e6, 1e-5, 1e-4, 123456789, 100, 0.1, 0.3, 2.675, 1.005, 9.995, 0.05, 99.5, 9.5}[g.r.Intn(22)])
	case 6:
		return math.Float64bits(g.r.NormFloat64() * math.Pow(10, float64(g.r.Intn(20)-10)))
	}
	return g.r.Uint64()
}

func (g *gen) float32bits() uint32 {
	switch g.r.Intn(6) {
	case 0:
		return []uint32{0, 1 << 31, 0x7F800000, 0xFF800000, 0x7FC00001, 1, 0x7F7FFFFF, 0x00800000, 0x007FFFFF, 0x4B800000, 0x3F800000}[g.r.Intn(11)]
	case 1:
		return math.Float32bits(float32(g.r.Intn(2000)-1000) / 8)
	case 2:
		return math.Float32bits(float32(g.r.Float64() * math.Pow(10, float64(g.r.Intn(20)-8))))
	case 3:
		return math.Float32bits(float32(math.Pow(2, float64(g.r.Intn(80)-40))))
	}
	return g.r.Uint32()
}

func (g *gen) str() []byte {
	var b []byte
	n := g.r.Intn(8)
	if g.r.Intn(12) == 0 {
		n = 20 + g.r.Intn(30)
	}
	for i := 0; i < n; i++ {
		switch g.r.Intn(9) {
		case 0, 1, 2:
			b = append(b, byte(0x20+g.r.Intn(0x5f)))
		case 3:
			b = utf8.AppendRune(b, rune(0x80+g.r.Intn(0x780)))
		case 4:
			b = utf8.AppendRune(b, rune(g.r.Intn(0x110000)))
		case 5:
			b = append(b, byte(g.r.Intn(0x20)), '\t', '\n', 0x7f)
		case 6:
			b = append(b, []byte{'`', '"', '\'', '\\', ' '}[g.r.Intn(5)])
		case 7:
			if g.r.Intn(3) == 0 { // invalid UTF-8
				b = append(b, byte(0x80+g.r.Intn(0x80)))
			} else {
				b = utf8.AppendRune(b, rune([]rune{0xFEFF, 0xFFFD, 0x1F600, 0x65E5, 0xE9, 0x2028, 0x200B, 0x0301}[g.r.Intn(8)]))
			}
		default:
			b = append(b, []byte("hello, world")[g.r.Intn(12)])
		}
	}
	return b
}

func (g *gen) scalar() Arg {
	switch g.r.Intn(20) {
	case 0, 1, 2, 3, 4, 5:
		return g.intArg(g.pick(intTypes))
	case 6, 7, 8, 9:
		return Arg{T: "float64", V: js(fmt.Sprintf("%016x", g.float64bits()))}
	case 10, 11:
		return Arg{T: "float32", V: js(fmt.Sprintf("%08x", g.float32bits()))}
	case 12, 13, 14, 15:
		return Arg{T: "string", V: js(b64(g.str()))}
	case 16:
		return Arg{T: "bytes", V: js(b64(g.str()))}
	case 17, 18:
		return Arg{T: "bool", V: js(g.r.Intn(2) == 0)}
	}
	return Arg{T: "nil"}
}

func (g *gen) list() Arg {
	n := 1 + g.r.Intn(4)
	var et string
	var mk func() json.RawMessage
	switch g.r.Intn(5) {
	case 0:
		et = "int"
		mk = func() json.RawMessage { return g.intArg("int").V }
	case 1:
		et = "string"
		mk = func() json.RawMessage { return js(b64(g.str())) }
	case 2:
		et = "float64"
		mk = func() json.RawMessage { return js(fmt.Sprintf("%016x", g.float64bits())) }
	case 3:
		et = "bool"
		mk = func() json.RawMessage { return js(g.r.Intn(2) == 0) }
	default:
		et = "int32"
		mk = func() json.RawMessage { return g.intArg("int32").V }
	}
	var vs []json.RawMessage
	for i := 0; i < n; i++ {
		vs = append(vs, mk())
	}
	return Arg{T: "[]" + et, V: js(vs)}
}

const verbs = "vdsqxXobcUeEfFgGtpTOwv"

func (g *gen) verb() string {
	switch g.r.Intn(12) {
	case 0:
		return g.pick([]string{"z", "é", "日", "y", "a", "!", "m", "k", "n", "S", "D", "\xff", "%"})
	case 1:
		return "%"
	}
	return string(verbs[g.r.Intn(len(verbs))])
}

func (g *gen) spec(nargs int) string {
	var sb strings.Builder
	sb.WriteByte('%')
	if g.r.Intn(2) == 0 {
		for i, n := 0, 1+g.r.Intn(3); i < n; i++ {
			sb.WriteByte("+-# 0"[g.r.Intn(5)])
		}
	}
	useIdx := g.r.Intn(4) == 0
	idx := func() string {
		if !useIdx {
			return ""
		}
		switch g.r.Intn(12) {
		case 0:
			return fmt.Sprintf("[%d]", 1+g.r.Intn(nargs+2))
		case 1:
			return g.pick([]string{"[0]", "[", "[x]", "[]", "[99]", "[1", "[-1]", "[1]]", "[ 1]"})
		case 2, 3:
			return fmt.Sprintf("[%d]", 1+g.r.Intn(max(nargs, 1)))
		}
		return ""
	}
	sb.WriteString(idx())
	switch g.r.Intn(8) {
	case 0, 1:
		sb.WriteString(strconv.Itoa(g.r.Intn(25)))
	case 2:
		sb.WriteByte('*')
	case 3:
		sb.WriteString(fmt.Sprintf("[%d]*", 1+g.r.Intn(max(nargs, 1))))
	case 4:
		if g.r.Intn(15) == 0 {
			sb.WriteString(strconv.Itoa(g.r.Intn(1500)))
		}
	}
	if g.r.Intn(3) == 0 {
		sb.WriteByte('.')
		sb.WriteString(idx())
		switch g.r.Intn(5) {
		case 0, 1:
			sb.WriteString(strconv.Itoa(g.r.Intn(30)))
		case 2:
			sb.WriteByte('*')
		case 3:
			if g.r.Intn(8) == 0 {
				sb.WriteString(strconv.Itoa(g.r.Intn(400)))
			}
		}
	}
	sb.WriteString(idx())
	if g.r.Intn(25) != 0 {
		sb.WriteString(g.verb())
	}
	return sb.String()
}

func (g *gen) format(nargs int) string {
	var sb strings.Builder
	n := 1 + g.r.Intn(3)
	for i := 0; i < n; i++ {
		if g.r.Intn(3) == 0 {
			sb.WriteString(g.pick([]string{"x=", " ", "[", "] ", "é", "日本", "100%% ", "\n", "(", ")", ":"}))
		}
		sb.WriteString(g.spec(nargs))
	}
	if g.r.Intn(4) == 0 {
		sb.WriteString(g.pick([]string{"!", " end", "%", "%%"}))
	}
	return sb.String()
}

func hasSlice(args []Arg) bool {
	for _, a := range args {
		if a.T == "bytes" || strings.HasPrefix(a.T, "[]") {
			return true
		}
	}
	return false
}

// focused builds a case with one clean spec (no index/star forms) and one argument of the
// requested kind, so that verb/flag/width/precision interactions get dense coverage.
func (g *gen) focused(kind string) Case {
	var arg Arg
	var vs string
	switch kind {
	case "float":
		if g.r.Intn(4) == 0 {
			arg = Arg{T: "float32", V: js(fmt.Sprintf("%08x", g.float32bits()))}
		} else {
			arg = Arg{T: "float64", V: js(fmt.Sprintf("%016x", g.float64bits()))}
		}
		vs = "vveEfFgGxXbsd"
	case "int":
		arg = g.intArg(g.pick(intTypes))
		vs = "vdbcoOqUxXeEsf"
	default: // text
		if g.r.Intn(3) == 0 {
			arg = g.intArg("int32")
			vs = "cqUvd"
		} else if g.r.Intn(4) == 0 {
			arg = Arg{T: "bytes", V: js(b64(g.str()))}
			vs = "sqxXvd"
		} else {
			arg = Arg{T: "string", V: js(b64(g.str()))}
			vs = "vsqxXd"
		}
	}
	var sb strings.Builder
	sb.WriteByte('%')
	for i, n := 0, g.r.Intn(4); i < n; i++ {
		sb.WriteByte("+-# 0"[g.r.Intn(5)])
	}
	if g.r.Intn(2) == 0 {
		sb.WriteString(strconv.Itoa(g.r.Intn(40)))
	}
	if g.r.Intn(2) == 0 {
		sb.WriteByte('.')
		if g.r.Intn(6) != 0 {
			if g.r.Intn(8) == 0 {
				sb.WriteString(strconv.Itoa(g.r.Intn(350)))
			} else {
				sb.WriteString(strconv.Itoa(g.r.Intn(25)))
			}
		}
	}
	sb.WriteByte(vs[g.r.Intn(len(vs))])
	return Case{F: sb.String(), A: []Arg{arg}}
}

func (g *gen) one() Case {
	nargs := g.r.Intn(4)
	if g.r.Intn(2) == 0 {
		nargs = 1
	}
	args := make([]Arg, nargs)
	for i := range args {
		if g.r.Intn(8) == 0 {
			args[i] = g.list()
		} else if g.r.Intn(4) == 0 {
			// small ints are common width/precision/index operands
			args[i] = Arg{T: "int", V: js(strconv.Itoa(g.r.Intn(30) - 5))}
		} else {
			args[i] = g.scalar()
		}
	}
	f := g.format(nargs)
	if strings.ContainsRune(f, 'p') && hasSlice(args) {
		// %p on a slice prints a heap address; not reproducible
		f = strings.ReplaceAll(f, "p", "v")
	}
	c := Case{A: args}
	if utf8.ValidString(f) {
		c.F = f
	} else {
		c.FB = b64([]byte(f))
	}
	return c
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: oracle gen|run")
		os.Exit(2)
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	switch os.Args[1] {
	case "gen":
		fs := flag.NewFlagSet("gen", flag.ExitOnError)
		seed := fs.Int64("seed", 1, "random seed")
		n := fs.Int("n", 30000, "number of cases")
		kind := fs.String("kind", "mixed", "mixed | float | int | text")
		fs.Parse(os.Args[2:])
		g := &gen{r: rand.New(rand.NewSource(*seed))}
		for i := 0; i < *n; i++ {
			var c Case
			if *kind == "mixed" {
				c = g.one()
			} else {
				c = g.focused(*kind)
			}
			evalSafe(&c)
			if c.O == "" && c.FB == "" && false {
				continue
			}
			enc.Encode(c)
		}
	case "run":
		sc := bufio.NewScanner(os.Stdin)
		sc.Buffer(make([]byte, 1<<20), 1<<26)
		for sc.Scan() {
			var c Case
			if err := json.Unmarshal(sc.Bytes(), &c); err != nil {
				panic(err)
			}
			eval(&c)
			enc.Encode(c)
		}
	}
}

func evalSafe(c *Case) {
	defer func() {
		if e := recover(); e != nil {
			panic(fmt.Sprintf("case %+v: %v", *c, e))
		}
	}()
	eval(c)
}
