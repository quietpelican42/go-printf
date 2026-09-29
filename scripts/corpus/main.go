package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
)

type Case struct {
	Fmt  string      `json:"fmt"`
	Type string      `json:"type"`
	Arg  interface{} `json:"arg"`
	Out  string      `json:"out"`
	Ok   bool        `json:"ok"` // verb valid for type (no %!)
}

func main() {
	r := rand.New(rand.NewSource(47))
	ints := []int64{0, 1, -1, 7, 42, -42, 255, -255, 65, 4096, 1 << 31, 1 << 40, 0x1F600}
	floats := []float64{0, 1, -1, 1.5, -2.25, 3.14159265358979, 100, 1e6, 123456789.123, 1e21, 1e-7, 0.000123, 2.5e10, 1234.5678}
	strs := []string{"", "hi", "héllo", "a\"b", "日本語", "tab\there", "x\ny", "\x00", "Go's", "long string with spaces"}
	bools := []bool{true, false}
	flagsets := []string{"", "-", "+", "#", "0", " ", "+0", "-+", "# ", "#0", "- "}
	widths := []string{"", "1", "5", "10", "12"}
	precs := []string{"", ".0", ".1", ".3", ".8"}
	intVerbs := "vdxXobcqUeEfgGs"
	fltVerbs := "vfeEgGsdxX"
	strVerbs := "vsqxXdc"
	boolVerbs := "vtds"
	var out []Case
	emit := func(f, t string, a interface{}, av interface{}, okverbs string, verb byte) {
		s := fmt.Sprintf(f, av)
		ok := false
		for i := 0; i < len(okverbs); i++ {
			if okverbs[i] == verb {
				ok = true
			}
		}
		out = append(out, Case{f, t, a, s, ok})
	}
	gen := func(verbs string, okverbs string, t string, pick func() (interface{}, interface{})) {
		for i := 0; i < 3000; i++ {
			v := verbs[r.Intn(len(verbs))]
			f := "%"
			for j := 0; j < 1+r.Intn(2); j++ {
				if r.Intn(3) == 0 {
					f += string(flagsets[r.Intn(len(flagsets))])
				}
			}
			f += widths[r.Intn(len(widths))]
			if r.Intn(3) == 0 {
				f += precs[r.Intn(len(precs))]
			}
			f += string(v)
			a, av := pick()
			emit(f, t, a, av, okverbs, v)
		}
	}
	gen(intVerbs, "vdxXobcqU", "int", func() (interface{}, interface{}) { x := ints[r.Intn(len(ints))]; return x, int(x) })
	gen(fltVerbs, "vfeEgG", "float", func() (interface{}, interface{}) { x := floats[r.Intn(len(floats))]; return x, x })
	gen(strVerbs, "vsqxX", "string", func() (interface{}, interface{}) { x := strs[r.Intn(len(strs))]; return x, x })
	gen(boolVerbs, "vt", "bool", func() (interface{}, interface{}) { x := bools[r.Intn(2)]; return x, x })
	// composite: slices / maps / structs with %v %+v %#v
	type P struct {
		Name string
		Age  int
	}
	for _, f := range []string{"%v", "%+v", "%#v", "%d", "%s", "%q", "%x", "%T"} {
		out = append(out, Case{f, "[]int", []int{1, 2, 3}, fmt.Sprintf(f, []int{1, 2, 3}), f == "%v" || f == "%+v" || f == "%#v" || f == "%d" || f == "%x"})
		out = append(out, Case{f, "[]string", []string{"a", "b c"}, fmt.Sprintf(f, []string{"a", "b c"}), f != "%d"})
		out = append(out, Case{f, "map[string]int", map[string]int{"b": 2, "a": 1}, fmt.Sprintf(f, map[string]int{"b": 2, "a": 1}), f == "%v" || f == "%+v" || f == "%#v"})
		out = append(out, Case{f, "struct", map[string]interface{}{"Name": "Al", "Age": 3}, fmt.Sprintf(f, P{"Al", 3}), f == "%v" || f == "%+v" || f == "%#v"})
		out = append(out, Case{f, "nil", nil, fmt.Sprintf(f, nil), false})
	}
	json.NewEncoder(os.Stdout).Encode(out)
}
